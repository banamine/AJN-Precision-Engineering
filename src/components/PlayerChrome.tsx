import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createScrubber } from "../utils/seekScrub";
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, PictureInPicture2, AudioLines, ChevronDown, SkipBack, SkipForward, Rewind, FastForward, Repeat1, Heart } from "lucide-react";
import type { AnalyzerState } from "./AudioVisualizerOverlay";
import type { Program, RecentlyPlayedItem } from "../types";
import { cleanArchiveMusicFilename } from "../utils/archiveMusicTitle";

export const HUD_HIDE_MS = 2500;

function archiveRowPresentation(item: {
  title?: string;
  subtitle?: string;
  archivePath?: string;
  src?: string;
  mediaUrl?: string;
}) {
  const cleaned = cleanArchiveMusicFilename(item.archivePath || item.src || item.mediaUrl || item.title);
  return {
    title: cleaned.title || item.title || "Untitled",
    artist: cleaned.artist || item.subtitle || "",
    rawFilename: cleaned.rawFilename || item.title || "Untitled",
  };
}

export function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

interface PlayerChromeProps {
  mediaRef: React.RefObject<HTMLMediaElement | null>;
  containerRef: React.RefObject<HTMLElement | null>;
  /** Changes whenever a new media element is mounted, so listeners re-attach. */
  sourceKey: string;
  isVideo: boolean;
  isPlaying: boolean;
  isMuted: boolean;
  volume: number;
  isFullscreen: boolean;
  statusText: string;
  title?: string;
  channelName?: string;
  subtitle?: string;
  onTogglePlay: () => void;
  onToggleMute: () => void;
  onVolume: (v: number) => void;
  onToggleFullscreen: () => void;
  visualizerOn: boolean;
  /** Live Radio briefing reserves a visible visualizer strip, so the toggle is intentionally locked on. */
  visualizerLockedOn?: boolean;
  onToggleVisualizer: () => void;
  analyzerState: AnalyzerState;
  diagnosticsOpen: boolean;
  onToggleDiagnostics: () => void;
  /** Audio bar only. */
  thumbnailUrl?: string;
  onPrev?: () => void;
  onNext?: () => void;
  repeatOne?: boolean;
  onToggleRepeat?: () => void;
  archiveMusicMode?: boolean;
  archiveMusicTitle?: string;
  archiveMusicArtist?: string;
  archiveMusicRawFilename?: string;
  archiveMusicRecentlyPlayed?: readonly RecentlyPlayedItem[];
  archiveMusicUpcoming?: readonly Program[];
  onResumeRecentlyPlayed?: (item: RecentlyPlayedItem) => void;
  onSelectUpcoming?: (program: Program) => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
}

const PILL: Record<AnalyzerState, { dot: string; text: string; label: string }> = {
  active: { dot: "bg-emerald-400", text: "text-sky-300", label: "Analyzer Active" },
  idle: { dot: "border border-neutral-500", text: "text-neutral-400", label: "Idle / Bypass" },
  unavailable: { dot: "border border-neutral-600", text: "text-neutral-500", label: "Analyzer Unavailable" },
};

/**
 * Floating metadata HUD (top) and transport bar (bottom) for MinimalPlayer.
 * Video: both overlay the picture and auto-hide after 2.5 s of inactivity while playing.
 * Audio: the transport renders inline (there is no picture to overlay) and never hides.
 * Time/duration are read from the media element itself, not from React state ticks.
 */
export function PlayerChrome(p: PlayerChromeProps) {
  const [time, setTime] = useState({ t: 0, d: NaN, b: 0 });
  const [draft, setDraft] = useState<number | null>(null);
  const mediaRefForSeek = p.mediaRef;
  const scrubber = useMemo(() => createScrubber({
    commit: (sec) => { const m = mediaRefForSeek.current; if (m) { try { m.currentTime = sec; } catch { /* not seekable yet */ } } },
    onDraft: setDraft,
  }), [mediaRefForSeek]);
  useEffect(() => () => scrubber.cancel(), [scrubber]);
  const [visible, setVisible] = useState(true);
  const [pip, setPip] = useState(false);
  const hideTimer = useRef<number | null>(null);
  const hoverRef = useRef(false);
  const playingRef = useRef(p.isPlaying);
  playingRef.current = p.isPlaying;

  // Read the playhead directly from the DOM node.
  useEffect(() => {
    const m = p.mediaRef.current;
    if (!m) return;
    const read = () => {
      let b = 0;
      try { if (m.buffered.length) b = m.buffered.end(m.buffered.length - 1); } catch { /* ignore */ }
      setTime({ t: m.currentTime, d: m.duration, b });
    };
    read();
    const evs = ["timeupdate", "durationchange", "loadedmetadata", "progress", "seeked", "emptied"];
    evs.forEach((e) => m.addEventListener(e, read));
    const onEnter = () => setPip(true);
    const onLeave = () => setPip(false);
    m.addEventListener("enterpictureinpicture", onEnter);
    m.addEventListener("leavepictureinpicture", onLeave);
    return () => {
      evs.forEach((e) => m.removeEventListener(e, read));
      m.removeEventListener("enterpictureinpicture", onEnter);
      m.removeEventListener("leavepictureinpicture", onLeave);
    };
  }, [p.mediaRef, p.sourceKey]);

  const clearTimer = () => { if (hideTimer.current !== null) { window.clearTimeout(hideTimer.current); hideTimer.current = null; } };
  const wake = useCallback(() => {
    setVisible(true);
    clearTimer();
    hideTimer.current = window.setTimeout(() => {
      if (playingRef.current && !hoverRef.current) setVisible(false);
    }, HUD_HIDE_MS);
  }, []);

  // Activity anywhere on the player wakes the overlays.
  useEffect(() => {
    const box = p.containerRef.current;
    if (!box || !p.isVideo) return;
    const evs = ["mousemove", "pointerdown", "touchstart", "focusin", "keydown"];
    evs.forEach((e) => box.addEventListener(e, wake, { passive: true }));
    return () => { evs.forEach((e) => box.removeEventListener(e, wake)); clearTimer(); };
  }, [p.containerRef, p.isVideo, wake]);

  // Paused → always visible; resuming starts the hide countdown.
  useEffect(() => {
    if (!p.isVideo) return;
    if (!p.isPlaying) { clearTimer(); setVisible(true); } else wake();
  }, [p.isPlaying, p.isVideo, wake]);

  // LIVE only when the browser reports an endless duration (a real live stream). While metadata is still
  // loading (or a stalled archive file never reports one) the duration is NaN/0: that is "unknown", never LIVE.
  const live = time.d === Infinity;
  const noDuration = !(Number.isFinite(time.d) && time.d > 0);
  // While the bar is being dragged the thumb and clock follow the DRAFT; the media is sought once, on release (see utils/seekScrub.ts).
  const shownT = draft !== null && !noDuration ? Math.min(draft, time.d) : time.t;
  const pct = noDuration ? 0 : Math.min(100, (shownT / time.d) * 100);
  const bufPct = noDuration ? 0 : Math.min(100, (time.b / time.d) * 100);
  const clockLabel = live ? <span className="text-red-400">LIVE ●</span> : noDuration ? <span className="text-neutral-400">Loading…</span> : `${formatClock(shownT)} / ${formatClock(time.d)}`;
  const canPip = p.isVideo && typeof document !== "undefined" && (document as Document & { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled === true;

  const togglePip = async () => {
    const m = p.mediaRef.current as HTMLVideoElement | null;
    if (!m) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await m.requestPictureInPicture();
    } catch { /* browser refused; leave the button state to the PiP events */ }
  };

  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!noDuration) scrubber.update((Number(e.target.value) / 1000) * time.d);
  };

  const btn = "flex h-8 w-8 shrink-0 sm:h-9 sm:w-9 items-center justify-center rounded-lg text-neutral-100 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400";
  const fade = p.isVideo ? `transition-opacity duration-300 ${visible ? "opacity-100" : "opacity-0 pointer-events-none"}` : "";
  const hasMeta = Boolean(p.title || p.channelName);
  const visualizerPressed = Boolean(p.visualizerOn || p.visualizerLockedOn);
  const visualizerLabel = p.visualizerLockedOn
    ? "Visualizer stays on while the Daily Briefing is displayed"
    : p.visualizerOn ? "Hide visualizer" : "Show visualizer";

  const transport = (
    <div
      data-testid="player-transport"
      onMouseEnter={() => { hoverRef.current = true; wake(); }}
      onMouseLeave={() => { hoverRef.current = false; wake(); }}
      className={`flex flex-wrap items-center gap-x-1.5 gap-y-0.5 p-2 ${p.isVideo ? "rounded-xl border border-neutral-800/80 bg-neutral-950/85 backdrop-blur-md" : ""} ${
        p.isVideo ? `absolute inset-x-2 bottom-2 z-20 sm:inset-x-3 sm:bottom-3 ${fade}` : "relative"
      }`}
    >
      <button type="button" className={btn} onClick={p.onTogglePlay} aria-label={p.isPlaying ? "Pause" : "Play"} title="Play/Pause (Space)">
        {p.isPlaying ? <Pause className="h-4 w-4 sm:h-5 sm:w-5" /> : <Play className="h-4 w-4 sm:h-5 sm:w-5" />}
      </button>
      <div className="group flex items-center">
        <button
          type="button"
          data-testid="mute-button"
          data-muted={p.isMuted ? "true" : "false"}
          className={`${btn} relative ${
            p.isMuted
              ? "mute-indicator-ring text-red-100 bg-red-950/50"
              : ""
          }`}
          onClick={p.onToggleMute}
          aria-label={p.isMuted ? "Muted — click to unmute" : "Unmuted — click to mute"}
          aria-pressed={p.isMuted}
          title={p.isMuted ? "Muted — click to unmute (M)" : "Mute (M)"}
        >
          {p.isMuted ? <VolumeX className="h-4 w-4 sm:h-5 sm:w-5 text-red-400" /> : <Volume2 className="h-4 w-4 sm:h-5 sm:w-5" />}
          <span className="sr-only">{p.isMuted ? "Muted" : "Unmuted"}</span>
        </button>
        <input
          type="range" min={0} max={1} step={0.05}
          value={p.isMuted ? 0 : p.volume}
          onChange={(e) => p.onVolume(Number(e.target.value))}
          aria-label="Volume"
          className="hidden h-1 w-0 cursor-pointer appearance-none overflow-hidden rounded bg-neutral-700 accent-sky-400 opacity-0 transition-all duration-200 group-hover:ml-1 group-hover:w-20 group-hover:opacity-100 group-focus-within:ml-1 group-focus-within:w-20 group-focus-within:opacity-100 sm:block"
        />
      </div>
      <span className="ml-auto shrink-0 font-mono text-[11px] sm:ml-0 tabular-nums text-neutral-200 sm:text-xs" data-testid="player-time">
        {clockLabel}
      </span>
      <div className="relative order-first mx-1 h-6 w-full min-w-0 basis-full sm:order-none sm:w-auto sm:flex-1 sm:basis-0">
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded bg-neutral-700/80">
          <div className="absolute inset-y-0 left-0 bg-neutral-500/70" style={{ width: `${bufPct}%` }} />
          <div className="absolute inset-y-0 left-0 bg-sky-400" style={{ width: `${pct}%` }} />
        </div>
        <input
          type="range" min={0} max={1000} step={1}
          value={Math.round(pct * 10)}
          onChange={seek}
          onPointerDown={() => scrubber.begin()}
          onPointerUp={() => scrubber.end()}
          onPointerCancel={() => scrubber.end()}
          onBlur={() => scrubber.end()}
          disabled={noDuration}
          aria-label="Seek"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
        />
      </div>
      <button
        type="button"
        data-testid="analyzer-pill"
        data-state={p.analyzerState}
        onClick={p.onToggleDiagnostics}
        aria-expanded={p.diagnosticsOpen}
        aria-controls="audio-bridge-drawer"
        aria-label={`${PILL[p.analyzerState].label} — ${p.diagnosticsOpen ? "hide" : "show"} diagnostics`}
        title="Diagnostics"
        className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-1.5 text-xs sm:h-9 sm:px-2 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${PILL[p.analyzerState].text}`}
      >
        <span className={`h-2 w-2 rounded-full ${PILL[p.analyzerState].dot}`} />
        <span className="hidden whitespace-nowrap md:inline">{PILL[p.analyzerState].label}</span>
        <ChevronDown className={`hidden h-3.5 w-3.5 transition-transform md:block ${p.diagnosticsOpen ? "rotate-180" : ""}`} />
      </button>
      <button
        type="button"
        disabled={p.visualizerLockedOn}
        className={`${btn} ${visualizerPressed ? "bg-sky-500/20 text-sky-300" : ""} ${p.visualizerLockedOn ? "cursor-not-allowed opacity-80" : ""}`}
        onClick={p.onToggleVisualizer}
        aria-pressed={visualizerPressed}
        aria-label={visualizerLabel}
        title={visualizerLabel}
      >
        <AudioLines className="h-4 w-4 sm:h-5 sm:w-5" />
      </button>
      {canPip && (
        <button type="button" className={`${btn} hidden sm:flex ${pip ? "bg-sky-500/20 text-sky-300" : ""}`} onClick={togglePip} aria-pressed={pip} aria-label={pip ? "Exit Picture-in-Picture" : "Picture-in-Picture"} title="Picture-in-Picture">
          <PictureInPicture2 className="h-4 w-4 sm:h-5 sm:w-5" />
        </button>
      )}
      {p.isVideo && (
        <button type="button" className={btn} onClick={p.onToggleFullscreen} aria-label={p.isFullscreen ? "Exit fullscreen" : "Fullscreen"} title="Fullscreen (F)">
          {p.isFullscreen ? <Minimize className="h-4 w-4 sm:h-5 sm:w-5" /> : <Maximize className="h-4 w-4 sm:h-5 sm:w-5" />}
        </button>
      )}
    </div>
  );

  const skip = (d: number) => {
    const m = p.mediaRef.current;
    if (!m || noDuration) return;
    m.currentTime = Math.max(0, Math.min(m.duration - 0.5, m.currentTime + d));
  };
  const tbtn = `${btn} disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent`;
  // Dedicated bottom-docked glass bar: its own row under the stage, so it never covers the visualizer or the art.
  const audioBar = (
    <div data-testid="audio-controls" className="relative z-10 border-t border-white/10 bg-[rgba(15,15,20,0.85)] px-3 pb-2 pt-2 backdrop-blur-[12px] sm:px-4">
      <div data-testid="player-transport" onMouseEnter={() => { hoverRef.current = true; }} onMouseLeave={() => { hoverRef.current = false; }}
        className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        {/* left: thumbnail + title/artist */}
        <div className="flex min-w-0 items-center gap-3">
          {p.thumbnailUrl
            ? <img src={p.thumbnailUrl} alt="" data-testid="audio-bar-thumb" className="h-11 w-11 shrink-0 rounded-md object-cover ring-1 ring-white/10" />
            : <div aria-hidden="true" data-testid="audio-bar-placeholder" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-neutral-800 text-sm font-bold text-neutral-300 ring-1 ring-white/10">{(p.title || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "♪"}</div>}
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-neutral-100" data-testid="audio-bar-title">{p.title || "Untitled"}</div>
            <div className="truncate text-[11px] text-neutral-400">
              {p.subtitle ? `${p.subtitle} · ` : p.channelName ? `${p.channelName} · ` : ""}<span data-testid="player-status">{p.statusText}</span>
            </div>
          </div>
        </div>
        {/* centre: transport */}
        <div className="flex items-center justify-center gap-0.5 sm:gap-1">
          <button type="button" className={tbtn} onClick={p.onPrev} disabled={!p.onPrev} aria-label="Previous track" title="Previous"><SkipBack className="h-4 w-4 sm:h-5 sm:w-5" /></button>
          <button type="button" className={`${tbtn} hidden sm:flex`} onClick={() => skip(-10)} disabled={noDuration} aria-label="Back 10 seconds" title="Back 10 s (←)"><Rewind className="h-4 w-4 sm:h-5 sm:w-5" /></button>
          <button type="button" className={`${btn} !h-10 !w-10 rounded-full bg-white/10`} onClick={p.onTogglePlay} aria-label={p.isPlaying ? "Pause" : "Play"} title="Play/Pause (Space)">
            {p.isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </button>
          <button type="button" className={`${tbtn} hidden sm:flex`} onClick={() => skip(10)} disabled={noDuration} aria-label="Forward 10 seconds" title="Forward 10 s (→)"><FastForward className="h-4 w-4 sm:h-5 sm:w-5" /></button>
          <button type="button" className={tbtn} onClick={p.onNext} disabled={!p.onNext} aria-label="Next track" title="Next"><SkipForward className="h-4 w-4 sm:h-5 sm:w-5" /></button>
          {p.onToggleRepeat && (
            <button type="button" className={`${btn} ${p.repeatOne ? "bg-sky-500/20 text-sky-300" : ""}`} onClick={p.onToggleRepeat} aria-pressed={p.repeatOne} aria-label={p.repeatOne ? "Repeat this track: on" : "Repeat this track: off"} title="Repeat this track"><Repeat1 className="h-4 w-4 sm:h-5 sm:w-5" /></button>
          )}
        </div>
        {/* right: volume, analyzer, visualizer */}
        <div className="flex items-center justify-end gap-1">
          <div className="group flex items-center">
            <button
              type="button"
              data-testid="mute-button"
              data-muted={p.isMuted ? "true" : "false"}
              className={`${btn} relative ${
                p.isMuted
                  ? "mute-indicator-ring text-red-100 bg-red-950/50"
                  : ""
              }`}
              onClick={p.onToggleMute}
              aria-label={p.isMuted ? "Muted — click to unmute" : "Unmuted — click to mute"}
              aria-pressed={p.isMuted}
              title={p.isMuted ? "Muted — click to unmute (M)" : "Mute (M)"}
            >
              {p.isMuted ? <VolumeX className="h-4 w-4 sm:h-5 sm:w-5 text-red-400" /> : <Volume2 className="h-4 w-4 sm:h-5 sm:w-5" />}
              <span className="sr-only">{p.isMuted ? "Muted" : "Unmuted"}</span>
            </button>
            <input type="range" min={0} max={1} step={0.05} value={p.isMuted ? 0 : p.volume} onChange={(e) => p.onVolume(Number(e.target.value))} aria-label="Volume"
              className="ml-1 hidden h-1 w-20 cursor-pointer appearance-none rounded bg-neutral-700 accent-sky-400 md:block" />
          </div>
          <button type="button" data-testid="analyzer-pill" data-state={p.analyzerState} onClick={p.onToggleDiagnostics} aria-expanded={p.diagnosticsOpen} aria-controls="audio-bridge-drawer"
            aria-label={`${PILL[p.analyzerState].label} — ${p.diagnosticsOpen ? "hide" : "show"} diagnostics`} title="Diagnostics"
            className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-1.5 text-xs sm:h-9 sm:px-2 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${PILL[p.analyzerState].text}`}>
            <span className={`h-2 w-2 rounded-full ${PILL[p.analyzerState].dot}`} />
            <span className="hidden whitespace-nowrap lg:inline">{PILL[p.analyzerState].label}</span>
            <ChevronDown className={`hidden h-3.5 w-3.5 transition-transform lg:block ${p.diagnosticsOpen ? "rotate-180" : ""}`} />
          </button>
          <button type="button" disabled={p.visualizerLockedOn} className={`${btn} ${visualizerPressed ? "bg-sky-500/20 text-sky-300" : ""} ${p.visualizerLockedOn ? "cursor-not-allowed opacity-80" : ""}`} onClick={p.onToggleVisualizer} aria-pressed={visualizerPressed}
            aria-label={visualizerLabel} title={visualizerLabel}><AudioLines className="h-4 w-4 sm:h-5 sm:w-5" /></button>
        </div>
      </div>
      {/* seek row: elapsed — bar — total */}
      <div className="mt-1 flex items-center gap-2 font-mono text-[11px] tabular-nums text-neutral-300">
        <span data-testid="player-time" className="order-none shrink-0">{clockLabel}</span>
        <div className="relative mx-1 h-6 min-w-0 flex-1">
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded bg-neutral-700/80">
            <div className="absolute inset-y-0 left-0 bg-neutral-500/70" style={{ width: `${bufPct}%` }} />
            <div className="absolute inset-y-0 left-0 bg-sky-400" style={{ width: `${pct}%` }} />
          </div>
          <input type="range" min={0} max={1000} step={1} value={Math.round(pct * 10)} onChange={seek} disabled={noDuration} aria-label="Seek"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default" />
        </div>
      </div>
    </div>
  );

  const archiveMusicPanels = p.archiveMusicMode ? (
    <div
      data-testid="archive-music-panels"
      className="grid grid-cols-1 gap-3 bg-slate-950 p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,1.2fr)_minmax(0,1fr)]"
    >
      <section data-testid="archive-music-recently-played" aria-labelledby="archive-music-recent-heading" className="min-w-0 rounded-2xl border border-cyan-900/70 bg-slate-900/80 p-4 shadow-lg shadow-black/20">
        <h2 id="archive-music-recent-heading" className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-slate-100">Recently Played</h2>
        {p.archiveMusicRecentlyPlayed?.length ? (
          <ul className="space-y-1">
            {p.archiveMusicRecentlyPlayed.slice(0, 6).map((item) => {
              const row = archiveRowPresentation(item);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    data-testid="archive-music-recent-item"
                    title={row.rawFilename}
                    aria-label={`Resume ${row.title}${row.artist ? ` by ${row.artist}` : ""}`}
                    onClick={() => p.onResumeRecentlyPlayed?.(item)}
                    className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-left text-slate-100 transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                  >
                    <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-cyan-800 bg-slate-950 text-cyan-200">♪</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{row.title}</span>
                      <span className="block truncate text-xs text-slate-300">{row.artist || "Library"}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="py-3 text-sm text-slate-300">No recent Archive music.</p>
        )}
      </section>

      <section data-testid="archive-music-now-playing" aria-labelledby="archive-music-now-heading" aria-label={`Now playing ${p.archiveMusicTitle || "Archive track"}${p.archiveMusicArtist ? ` by ${p.archiveMusicArtist}` : ""}`} title={p.archiveMusicRawFilename || undefined} className="min-w-0 rounded-2xl border border-cyan-500/50 bg-slate-900/90 p-4 shadow-[0_0_30px_rgba(34,211,238,0.08)]">
        <h2 id="archive-music-now-heading" className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-slate-100">Now Playing</h2>
        <div data-testid="audio-controls" className="space-y-3">
          <div className="flex min-h-11 items-center justify-between gap-2">
            <div className="flex min-w-0 items-center justify-center gap-2 sm:gap-3">
              <button type="button" className={`${btn} !h-11 !w-11`} onClick={p.onPrev} disabled={!p.onPrev} aria-label="Previous track" title="Previous track">
                <SkipBack className="h-5 w-5" />
              </button>
              <button type="button" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-cyan-300 text-slate-950 transition hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white" onClick={p.onTogglePlay} aria-label={p.isPlaying ? "Pause" : "Play"} title={p.isPlaying ? "Pause" : "Play"}>
                {p.isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
              </button>
              <button type="button" className={`${btn} !h-11 !w-11`} onClick={p.onNext} disabled={!p.onNext} aria-label="Next track" title="Next track">
                <SkipForward className="h-5 w-5" />
              </button>
            </div>
            <div className="flex min-h-11 shrink-0 items-center gap-1">
              <button
                type="button"
                data-testid="mute-button"
                aria-label={p.isMuted ? "Muted — click to unmute" : "Unmuted — click to mute"}
                aria-pressed={p.isMuted}
                onClick={p.onToggleMute}
                className={`${btn} !h-11 !w-11 ${p.isMuted ? "bg-red-950/50 text-red-300" : "text-slate-100"}`}
              >
                {p.isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={p.isMuted ? 0 : p.volume}
                onChange={(event) => p.onVolume(Number(event.target.value))}
                aria-label="Volume"
                className="h-11 w-16 cursor-pointer accent-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 sm:w-24"
              />
            </div>
          </div>

          <div className="flex min-h-10 items-center gap-2 font-mono text-xs tabular-nums text-slate-200">
            <span data-testid="player-time" className="shrink-0">{clockLabel}</span>
            <div className="relative h-11 min-w-0 flex-1">
              <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-slate-700">
                <div className="absolute inset-y-0 left-0 bg-slate-400/80" style={{ width: `${bufPct}%` }} />
                <div className="absolute inset-y-0 left-0 rounded-full bg-cyan-300" style={{ width: `${pct}%` }} />
              </div>
              <input
                type="range"
                min={0}
                max={1000}
                step={1}
                value={Math.round(pct * 10)}
                onChange={seek}
                disabled={noDuration}
                aria-label="Seek"
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
              />
            </div>
          </div>

          <div className="flex min-h-11 items-center justify-between gap-3 border-t border-slate-700/80 pt-2">
            {p.onToggleFavorite && (
              <button
                type="button"
                data-testid="player-heart"
                aria-pressed={Boolean(p.isFavorite)}
                aria-label={p.isFavorite ? "Remove current track from favorites" : "Add current track to favorites"}
                title={p.isFavorite ? "Remove from Favorites" : "Add to Favorites"}
                onClick={p.onToggleFavorite}
                className={`flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${p.isFavorite ? "text-rose-300" : "text-slate-100 hover:bg-slate-800"}`}
              >
                <Heart className={`h-4 w-4 ${p.isFavorite ? "fill-rose-400 text-rose-400" : ""}`} aria-hidden="true" />
                {p.isFavorite ? "Favorited" : "Favorite"}
              </button>
            )}
          </div>
          <p data-testid="player-status" className="sr-only" aria-live="polite">{p.statusText}</p>
        </div>
      </section>

      <section data-testid="archive-music-up-next" aria-labelledby="archive-music-up-next-heading" className="min-w-0 rounded-2xl border border-cyan-900/70 bg-slate-900/80 p-4 shadow-lg shadow-black/20">
        <h2 id="archive-music-up-next-heading" className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-slate-100">Up Next</h2>
        {p.archiveMusicUpcoming?.length ? (
          <ol className="space-y-1">
            {p.archiveMusicUpcoming.slice(0, 6).map((program, index) => {
              const row = archiveRowPresentation(program);
              return (
                <li key={`${program.id}-${index}`}>
                  <button
                    type="button"
                    data-testid="archive-music-up-next-item"
                    title={row.rawFilename}
                    aria-label={`Play next: ${row.title}${row.artist ? ` by ${row.artist}` : ""}`}
                    onClick={() => p.onSelectUpcoming?.(program)}
                    className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-left text-slate-100 transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                  >
                    <span aria-hidden="true" className="w-5 shrink-0 text-center font-mono text-xs text-cyan-200">{String(index + 1).padStart(2, "0")}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{row.title}</span>
                      <span className="block truncate text-xs text-slate-300">{row.artist || "Library"}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="py-3 text-sm text-slate-300">Upcoming tracks unavailable.</p>
        )}
      </section>
    </div>
  ) : null;

  return (
    <>
      {p.isVideo && (
        <div
          data-testid="player-hud"
          className={`pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/85 via-black/40 to-transparent p-3 sm:p-4 ${fade}`}
        >
          <div className="min-w-0">
            {p.channelName && <div className="truncate font-mono text-[10px] uppercase tracking-widest text-sky-300 sm:text-xs">{p.channelName}</div>}
            {hasMeta && p.title && <div className="truncate text-sm font-semibold text-white sm:text-lg">{p.title}</div>}
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-neutral-300 sm:text-xs">
              {live && <span className="rounded bg-red-600 px-1.5 py-0.5 font-bold tracking-wide text-white">LIVE</span>}
              {p.subtitle && <span className="truncate">{p.subtitle}</span>}
              <span data-testid="player-status">{p.statusText}</span>
            </div>
          </div>
        </div>
      )}
      {p.isVideo ? transport : p.archiveMusicMode ? archiveMusicPanels : audioBar}
    </>
  );
}
