import { scheduleResumePromptFade } from "./utils/resumePromptFade";
import { clampStart } from "./utils/avSync";
import { attachPlayTimeline } from "./utils/playTimeline";
import { createProgressWatchdog } from "./utils/progressWatchdog";
import { bufferGaugeMetadata, createBufferGauge, type BufferGaugeSnapshot } from "./utils/bufferGauge";
import { playerKeyAction, seekDelta } from "./utils/playerKeys";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { bridgeSrc, corsModeFor, NO_METER_MARK, RESOLVED_MARK, podcastAllowsMeter, liveRadioAllowsMeter } from "./utils/mediaRoute";
import Hls from "hls.js";
import { getBufferSamples, reportBufferSample, reportTelemetry } from "./telemetry";
import { NowPlayingMedia, MediaType } from "./types";
import type { Program, RecentlyPlayedItem } from "./types";
import { PlayerChrome } from "./components/PlayerChrome";
import { WaitingNotes } from "./components/WaitingNotes";
import { archiveFailureDiagnosticUrl, classifyArchiveFailure, overloadedMessage, type ProxyErrorBody } from "./utils/archiveFailure";
import { releaseMediaElementAudioSource, useAudioNormalization } from "./use-audio-normalization";
import { AudioBridgeStatus } from "./components/AudioBridgeStatus";
import { AudioVisualizerOverlay, useAnalyzerState } from "./components/AudioVisualizerOverlay";
import { ArchiveMusicSpectrum } from "./components/ArchiveMusicSpectrum";
import { useFolderArt } from "./utils/useFolderArt";
import { usePersistentFlag } from "./utils/persistentFlag";
import { useFrameCapture } from "./utils/useFrameCapture";
import { archiveIdentifierFromPath } from "./utils/thumbnail";
import { isLiveRadioPlayback } from "./utils/isLiveRadioPlayback";
import { RadioBriefingPlayerOverlay } from "./components/RadioBriefingPlayerOverlay";
import { attachArchiveVideoPrefetch, type VideoPrefetchTarget } from "./utils/videoPrefetch";
import { cleanArchiveMusicFilename } from "./utils/archiveMusicTitle";
import { isArchiveMusicPlayback } from "./utils/isArchiveMusicPlayback";
import { recordArchivePlaybackProgress } from "./utils/archivePlaybackEvidence";
import { archiveSubtitleUrl } from "./utils/archiveSubtitles";

interface MinimalPlayerProps {
  src: string;
  title?: string;
  mediaType?: MediaType;
  onProgramEnded?: () => void;
  nowPlaying?: NowPlayingMedia;
  onPlayEvent?: () => void;
  /** Text for the button shown when the browser refuses to start playback on its own. */
  autoplayBlockedLabel?: string;
  onPauseEvent?: () => void;
  onErrorEvent?: (err: MediaError | null, proxyFailure?: ProxyErrorBody | null) => void;
  onProgressEvent?: (positionSeconds: number) => void;
  /** Audio only: what plays after this item (already a playable URL), or null. Called once, near the end of the track. */
  resolveNext?: () => Promise<VideoPrefetchTarget | null>;
  /** Audio bar skip buttons; omitted (button disabled) when there is no neighbour to go to. */
  onPrev?: () => void;
  onNext?: () => void;
  /** Shown with a failure message: reload this item. */
  onRetry?: () => void;
  /** Shown with a failure message: leave the stalled item and pick something else. */
  onBackToGuide?: () => void;
  archiveMusicMode?: boolean;
  archiveMusicRecentlyPlayed?: readonly RecentlyPlayedItem[];
  archiveMusicUpcoming?: readonly Program[];
  onResumeRecentlyPlayed?: (item: RecentlyPlayedItem) => void;
  onSelectUpcoming?: (program: Program) => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
}

const TV_NEWS_SLICE_SEC = 300;
const TV_NEWS_TOTAL_SEC = 3600;
const RESUME_MIN_SEC = 5;
const RESUME_SAVE_INTERVAL_MS = 5000;
// Relaxed buffering: a slow or briefly failing Archive slice is retried in place
// (same position) before the item is declared failed and the channel skips ahead.
const RECOVER_DELAYS_MS = [1000, 3000, 6000];
const STALL_WATCHDOG_MS = 20_000; // "Buffering…" longer than this triggers a reconnect, not a skip
const WAIT_BUDGET_MS = 108_000; // Archive can take a long time to first byte: the wait counter and the start watchdog both run to 108 s
const START_WATCHDOG_MS = WAIT_BUDGET_MS; // "Loading…" with no metadata after this is retried (same budget), then reported as failed
const RECOVERED_AFTER_SECONDS = 20; // playing this far past a failure resets the retry budget
// Audio gapless-ish handoff: this close to the end the next track is fetched into a hidden element.
const PRELOAD_LEAD_SEC = 45;
const RESUME_PROMPT_VISIBLE_MS = 10_000; // Resume / Start Over prompt stays this long when untouched, then fades
const RESUME_PROMPT_FADE_MS = 600;
const RESUME_PREFIX = "ajn-playback-position:";

function bufferedEndAt(media: HTMLMediaElement): number {
  const currentTime = media.currentTime;
  try {
    for (let index = 0; index < media.buffered.length; index += 1) {
      const start = media.buffered.start(index);
      const end = media.buffered.end(index);
      if (currentTime >= start - 0.25 && currentTime <= end + 0.25) return end;
    }
  } catch { /* The browser can clear TimeRanges during a source swap. */ }
  return 0;
}

function bufferClockNowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function bufferLine(snapshot: BufferGaugeSnapshot, active: boolean): string {
  if (!active || snapshot.health === "idle") return "Buffer: idle";
  const fillRate = snapshot.fillRateRatio === null ? "fill pending" : `${snapshot.fillRateRatio.toFixed(1)}x`;
  const base = `Buffer ${Math.round(snapshot.aheadSeconds)} s ahead · ${snapshot.health} ${fillRate} · ${snapshot.underrunCount} underruns`;
  return snapshot.kbps === null ? base : `${base} · needs ~${(snapshot.kbps / 1000).toFixed(1)} Mbit/s`;
}

// Session-wide sound choice: once the user unmutes, every later program
// (including scheduler auto-advance, which remounts this player) stays unmuted
// until the app is closed or reloaded.
let sessionUnmuted = false;

export default function MinimalPlayer({ src, title, mediaType = "video", onProgramEnded, nowPlaying, onPlayEvent, onPauseEvent, onErrorEvent, onProgressEvent, autoplayBlockedLabel, resolveNext, onPrev, onNext, onRetry, onBackToGuide, archiveMusicMode, archiveMusicRecentlyPlayed, archiveMusicUpcoming, onResumeRecentlyPlayed, onSelectUpcoming, isFavorite, onToggleFavorite }: MinimalPlayerProps) {
  const mediaRef = useRef<HTMLMediaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastSavedPositionRef = useRef(0);
  const playingReportedRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  // Autoplay starts muted on every app load. Once the user unmutes, keep that
  // choice for the rest of this app session; a reload intentionally resets it.
  const [isMuted, setIsMuted] = useState(() => !sessionUnmuted);
  const [volume, setVolume] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [statusText, setStatusText] = useState("Loading…");
  const [activeSrc, setActiveSrc] = useState(() => bridgeSrc(src));
  const [resumePosition, setResumePosition] = useState<number | null>(null);
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const [resumePromptFading, setResumePromptFading] = useState(false);

  const isVideo = mediaType === "video";
  const radioBriefingOn = isLiveRadioPlayback(mediaType, nowPlaying);
  const archiveMusicOn = archiveMusicMode ?? isArchiveMusicPlayback(mediaType, nowPlaying?.channelId);
  const archiveMusicModeRef = useRef(archiveMusicOn);
  archiveMusicModeRef.current = archiveMusicOn;
  // Optional: save a real frame for items Archive has no image for (see utils/thumbStore.ts). No effect otherwise.
  useFrameCapture(mediaRef, archiveIdentifierFromPath(nowPlaying?.archivePath ?? activeSrc), isVideo);
  const isHls = /\.m3u8(\?|$)/i.test(activeSrc ?? "") || (activeSrc ?? "").startsWith("/api/hls/");
  const bufferItemKey = nowPlaying?.programId ?? nowPlaying?.assetId ?? nowPlaying?.sourceId ?? nowPlaying?.archivePath ?? src;
  const initialBufferMetadata = bufferGaugeMetadata(nowPlaying?.bufferMetadata);
  const bufferGaugeRef = useRef(createBufferGauge({ ...(initialBufferMetadata ?? {}), now: bufferClockNowMs }));
  const [bufferGaugeSnapshot, setBufferGaugeSnapshot] = useState<BufferGaugeSnapshot>(() => bufferGaugeRef.current.snapshot());
  const waitingForDataRef = useRef(false);
  const hasStartedPlaybackRef = useRef(false);
  useEffect(() => {
    const metadata = bufferGaugeMetadata(nowPlaying?.bufferMetadata);
    bufferGaugeRef.current = createBufferGauge({ now: bufferClockNowMs, ...(metadata ?? {}) });
    waitingForDataRef.current = false;
    hasStartedPlaybackRef.current = false;
    setBufferGaugeSnapshot(bufferGaugeRef.current.snapshot());
  }, [bufferItemKey, nowPlaying?.bufferMetadata?.bytes, nowPlaying?.bufferMetadata?.durationSeconds]);
  const hlsRef = useRef<Hls | null>(null);
  // Only request CORS for our own origin (the Archive proxy). Hosts such as
  // archive.alexjoneslive.com send no CORS headers, so crossOrigin={corsMode}
  // makes the browser refuse the file outright. Without it the file plays and
  // the audio bridge falls back to native output.
  const corsMode = corsModeFor(activeSrc, isHls, nowPlaying?.programId);
  // Read in effects without re-running them: toggling mute must not reload media.
  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;
  useEffect(() => { if (mediaRef.current) mediaRef.current.muted = isMuted; }, [isMuted]);

  // ── Audio element ownership + next-track preload ──────────────────────────────
  // Audio is not a JSX <audio key=...>: the element lives in `audioHostRef` so the NEXT track's
  // element (created hidden, already buffering) can be adopted as the playing element instead of
  // building a fresh one. Each element still gets its own Web Audio source exactly once.
  const audioHostRef = useRef<HTMLDivElement>(null);
  const [repeatOne, setRepeatOne] = useState(false);
  const folderArt = useFolderArt(nowPlaying?.archivePath, mediaType !== "video");
  const artUrl = folderArt[0]?.url ?? nowPlaying?.thumbnailUrl;
  const archiveTrack = useMemo(
    () => cleanArchiveMusicFilename(nowPlaying?.archivePath ?? activeSrc),
    [nowPlaying?.archivePath, activeSrc],
  );
  const archiveMusicTitle = archiveTrack.title || title || nowPlaying?.title || "Untitled";
  const archiveMusicArtist = archiveTrack.artist || nowPlaying?.subtitle || "";
  const archiveMusicRawFilename = archiveTrack.rawFilename || nowPlaying?.title || "";
  const sideArt = folderArt.slice(1, 3);
  const preloadRef = useRef<{ src: string; el: HTMLAudioElement } | null>(null);
  const adoptedRef = useRef(false);
  const restoreHandledRef = useRef(false);   // the launch-restored item has been started by the user
  const handoffUntilRef = useRef(0);          // track-to-track handoff: keep the OS session 'playing'
  const repeatRef = useRef(false);
  repeatRef.current = repeatOne;
  useEffect(() => { if (mediaRef.current) mediaRef.current.loop = repeatOne; }, [repeatOne]);
  const disposePreload = useCallback(() => {
    const pre = preloadRef.current;
    preloadRef.current = null;
    if (!pre) return;
    pre.el.pause();
    pre.el.removeAttribute("src");
    pre.el.load();
  }, []);
  // Latest callbacks, read by the media effect so parent re-renders never re-run
  // it (a re-run calls load(), which aborts the play() in flight).
  const resumeKey = `${RESUME_PREFIX}${nowPlaying?.programId ?? activeSrc}`;

  const { diagnosticsAnalyserRef, resumeAudioContext } = useAudioNormalization(
    mediaRef,
    isVideo ? "video" : "audio",
    activeSrc,
  );

  // Phase 3/4: diagnostics drawer is collapsed by default and remembers the user's choice;
  // the overlay visualizer reads the same analyser tap (no extra audio nodes).
  const [diagnosticsOpen, setDiagnosticsOpen] = usePersistentFlag("ajn_diagnostics_expanded", false);
  const [visualizerOn, setVisualizerOn] = usePersistentFlag("ajn_visualizer_enabled", true);
  const analyserNode = diagnosticsAnalyserRef.current;
  const analyzerState = useAnalyzerState(analyserNode, isPlaying);

  const eventMeta = useCallback(() => ({
    guideId: nowPlaying?.guideId ?? null,
    channelId: nowPlaying?.channelId ?? null,
    sourceId: nowPlaying?.sourceId ?? null,
    programId: nowPlaying?.programId ?? null,
    titleId: `${nowPlaying?.channelId || 'none'}/${String(nowPlaying?.title ?? title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'untitled'}`,
    assetId: nowPlaying?.assetId ?? null,
    mediaPath: nowPlaying?.archivePath ?? activeSrc ?? null,
    archiveIdentifier: archiveIdentifierFromPath(nowPlaying?.archivePath ?? activeSrc) ?? null,
  }), [nowPlaying, activeSrc, title]);

  const readResumePosition = useCallback(() => {
    try {
      const saved = Number.parseFloat(localStorage.getItem(resumeKey) ?? "");
      return Number.isFinite(saved) && saved >= RESUME_MIN_SEC ? saved : null;
    } catch {
      return null;
    }
  }, [onProgressEvent, resumeKey]);

  const saveResumePosition = useCallback((media: HTMLMediaElement) => {
    if (Number.isFinite(media.currentTime)) onProgressEvent?.(media.currentTime);
    if (!Number.isFinite(media.currentTime) || media.currentTime < RESUME_MIN_SEC) return;
    if (Number.isFinite(media.duration) && media.duration > 0 && media.currentTime >= media.duration - 5) {
      try { localStorage.removeItem(resumeKey); } catch {}
      return;
    }
    const now = Date.now();
    if (now - lastSavedPositionRef.current < RESUME_SAVE_INTERVAL_MS) return;
    lastSavedPositionRef.current = now;
    try { localStorage.setItem(resumeKey, String(media.currentTime)); } catch {}
  }, [resumeKey]);

  const clearResumePosition = useCallback(() => {
    try { localStorage.removeItem(resumeKey); } catch {}
    setResumePosition(null);
    setShowResumePrompt(false);
  }, [resumeKey]);

  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const reportPlaying = useCallback(() => {
    restoreHandledRef.current = true;
    setAutoplayBlocked(false);
    setIsPlaying(true);
    setStatusText("Playing");
    if (!playingReportedRef.current) {
      playingReportedRef.current = true;
      reportTelemetry({ event: "playback.started", ...eventMeta() });
      onPlayEvent?.();
    }
  }, [eventMeta, onPlayEvent]);

  // One-shot start offset from the audio/video switch: applied once per play, on loadedmetadata.
  const nowPlayingRef = useRef(nowPlaying);
  nowPlayingRef.current = nowPlaying;
  const startAtConsumedRef = useRef<unknown>(null);

  const fnRef = useRef({ eventMeta, readResumePosition, saveResumePosition, clearResumePosition, reportPlaying, onPauseEvent, onProgramEnded, onErrorEvent });
  fnRef.current = { eventMeta, readResumePosition, saveResumePosition, clearResumePosition, reportPlaying, onPauseEvent, onProgramEnded, onErrorEvent };

  useLayoutEffect(() => {
    if (isVideo) return;
    const host = audioHostRef.current;
    if (!host || !activeSrc) return;
    const pre = preloadRef.current;
    let el: HTMLAudioElement;
    if (pre && pre.src === activeSrc && !pre.el.error) {
      el = pre.el; preloadRef.current = null; adoptedRef.current = true;
    } else {
      disposePreload(); adoptedRef.current = false;
      el = new Audio();
      const cors = corsModeFor(activeSrc, false, nowPlayingRef.current?.programId);
      if (cors) el.crossOrigin = cors; // before src: decides whether Web Audio may read the file
      // The item restored at launch waits for the user: fetch nothing (a proxied metadata read can pull up to an 8 MiB slice)
      // until Play is pressed. Every normal play starts immediately, so it keeps "metadata".
      el.preload = nowPlayingRef.current?.restoredPaused && !restoreHandledRef.current ? "none" : "metadata";
      el.src = activeSrc;
    }
    // A session restored at launch waits for the user (tap / car Play); everything else starts by itself.
    el.autoplay = !(nowPlayingRef.current?.restoredPaused && !restoreHandledRef.current);
    el.loop = repeatRef.current;
    el.muted = isMutedRef.current;
    el.className = "w-full";
    el.setAttribute("data-testid", "audio-element");
    host.replaceChildren(el);
    mediaRef.current = el;
    attachPlayTimeline(el, { restored: Boolean(nowPlayingRef.current?.restoredPaused && !restoreHandledRef.current), src: activeSrc, startAtSeconds: nowPlayingRef.current?.startAtSeconds });
  }, [isVideo, activeSrc, disposePreload]);
  // Leaving the player: release the playing element and any warm one.
  useEffect(() => () => {
    disposePreload();
    const el = mediaRef.current;
    if (el instanceof HTMLAudioElement) { el.pause(); el.removeAttribute("src"); el.load(); }
    if (archiveMusicModeRef.current && el) releaseMediaElementAudioSource(el);
  }, [disposePreload]);

  // Near the end of an audio track, ask for the next one and start buffering it in a hidden element.
  useEffect(() => {
    if (isVideo || isHls || !resolveNext) return;
    const media = mediaRef.current;
    if (!media) return;
    let asked = false;
    let live = true;
    const onTime = () => {
      if (asked) return;
      const d = media.duration, t = media.currentTime;
      if (!Number.isFinite(d) || d <= 0) return;
      if (d - t > Math.min(PRELOAD_LEAD_SEC, d * 0.5)) return;
      asked = true;
      void resolveNext().then((n) => {
        if (!live || !n || n.mediaType !== "audio") return;
        const nextSrc = bridgeSrc(n.src);
        if (!nextSrc || nextSrc === activeSrc || /\.m3u8(\?|$)/i.test(nextSrc) || nextSrc.startsWith("/api/hls/")) return;
        disposePreload();
        const el = new Audio();
        const cors = corsModeFor(nextSrc, false, n.programId);
        if (cors) el.crossOrigin = cors;
        el.preload = "auto";
        el.addEventListener("error", () => { if (preloadRef.current?.el === el) disposePreload(); }, { once: true });
        el.src = nextSrc;
        preloadRef.current = { src: nextSrc, el };
        reportTelemetry({ event: "playback.preload", ...eventMeta(), mediaPath: nextSrc });
      });
    };
    media.addEventListener("timeupdate", onTime);
    return () => { live = false; media.removeEventListener("timeupdate", onTime); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVideo, isHls, activeSrc, resolveNext, disposePreload]);

  useEffect(() => {
    if (!isVideo || isHls || !resolveNext) return;
    const media = mediaRef.current;
    if (!media) return;
    return attachArchiveVideoPrefetch({
      media,
      currentSrc: activeSrc,
      currentMediaType: mediaType,
      currentGuideId: nowPlaying?.guideId,
      currentChannelId: nowPlaying?.channelId,
      currentProgramId: nowPlaying?.programId,
      isHls,
      resolveNext,
      onTelemetry: (event) => reportTelemetry(event),
    });
  }, [activeSrc, isHls, isVideo, mediaType, nowPlaying?.channelId, nowPlaying?.guideId, nowPlaying?.programId, resolveNext]);

  useEffect(() => {
    setActiveSrc(bridgeSrc(src));
    setStatusText("Loading…");
    setIsPlaying(false);
    setResumePosition(null);
    setShowResumePrompt(false);
    setAutoplayBlocked(false);
    restoreHandledRef.current = false;
    playingReportedRef.current = false;
    lastSavedPositionRef.current = 0;
  }, [src, mediaType]);

  useEffect(() => {
    const fx = () => fnRef.current;
    const media = mediaRef.current;
    if (!media) return;

    // Set the property before attempting autoplay. This is required by
    // browser autoplay policy and avoids relying on JSX timing alone.
    media.muted = isMutedRef.current;
    // An adopted element was already told to load its source while hidden: calling load() again
    // would throw the buffered data away and bring the gap back.
    const adopted = !isVideo && adoptedRef.current;
    adoptedRef.current = false;
    if (!adopted) {
      if (!isHls && activeSrc && !media.getAttribute("src")) {
        media.src = activeSrc;
      }
      // An explicit load() fetches even with preload="none": the deferred (restored) item already has its src and starts on Play.
      if (media.preload !== "none") media.load();
    }

    const attemptAutoplay = async () => {
      if (!media.paused) return;
      // Session restored at launch: the browser would refuse sound (or start it muted). Wait for the tap / Bluetooth Play.
      if (nowPlayingRef.current?.restoredPaused && !restoreHandledRef.current) {
        setStatusText("Ready — tap Play to resume");
        setAutoplayBlocked(true);
        return;
      }
      resumeAudioContext();
      try {
        await media.play();
        if (!media.paused) fx().reportPlaying();
      } catch (error) {
        if ((error as DOMException)?.name === "AbortError") return;
        // Unmuted autoplay refused (no user gesture yet in this tab): play muted
        // rather than stall the schedule. The session preference is unchanged.
        if (!media.muted && (error as DOMException)?.name === 'NotAllowedError') {
          media.muted = true;
          setIsMuted(true);
          try { await media.play(); if (!media.paused) { fx().reportPlaying(); return; } } catch { /* fall through */ }
        }
        // Autoplay may still be blocked by the browser. Keep the real error
        // available in the console; the normal Play control remains usable.
        console.warn("[AJN PLAYBACK] autoplay blocked", {
          src: media.currentSrc,
          muted: media.muted,
          error,
          readyState: media.readyState,
          networkState: media.networkState,
        });
        if (media.paused) {
          setStatusText("Ready to play");
          // Not a lookup failure: the item is loaded, only the browser's permission is missing.
          setAutoplayBlocked(true);
          reportTelemetry({ event: "playback.autoplay_blocked", ...fx().eventMeta() });
        }
      }
    };

    const onLoadedMetadata = () => {
      clearStart();
      // Live streams have no fixed duration: never offer a resume position.
      const instance = nowPlayingRef.current;
      let switched = false;
      if (pendingSeek !== null) {
        // Recovering from a dropped connection: continue where playback stopped.
        const at = pendingSeek; pendingSeek = null;
        try { if (!Number.isFinite(media.duration) || at < media.duration - 1) { media.currentTime = at; } switched = true; } catch { switched = true; }
        startAtConsumedRef.current = instance;
      } else if (instance && startAtConsumedRef.current !== instance) {
        startAtConsumedRef.current = instance;
        const liveItem = String(instance.programId ?? "").includes(":live:") || String(instance.channelId ?? "").startsWith("radio:");
        const startAt = liveItem ? null : clampStart(instance.startAtSeconds, media.duration);
        if (startAt !== null) {
          try { media.currentTime = startAt; switched = true; } catch { /* element not seekable yet: fall through to normal start */ }
        }
      }
      const saved = !switched && Number.isFinite(media.duration) ? fx().readResumePosition() : null;
      setStatusText("Ready");
      if (saved !== null && (!Number.isFinite(media.duration) || saved < media.duration - 5)) {
        setResumePosition(saved);
        setShowResumePrompt(true);
      }
      void attemptAutoplay();
    };
    const onCanPlay = () => {
      waitingForDataRef.current = false;
      clearStart();
      if (media.paused) {
        setStatusText("Ready to play");
        void attemptAutoplay();
      }
    };
    const onPlay = (...a: []) => { waitingForDataRef.current = false; if (media.readyState < 1) armStart(); fx().reportPlaying(...a); };
    const onPlaying = (...a: []) => { waitingForDataRef.current = false; hasStartedPlaybackRef.current = true; clearStall(); clearStart(); fx().reportPlaying(...a); };
    const onTimeUpdate = () => {
      if (!media.paused) {
        onProgressOk();
        fx().reportPlaying();
        fx().saveResumePosition(media);
      }
    };
    // ── In-place recovery (transient network/proxy failures) ──────────────────
    let retries = 0;
    let retryTimer: number | null = null;
    let stallTimer: number | null = null;
    let startTimer: number | null = null;
    let slowRetried = false;
    let slowTimer: number | null = null;
    const clearStart = () => { if (startTimer !== null) { window.clearTimeout(startTimer); startTimer = null; } };
    const clearSlow = () => { if (slowTimer !== null) { window.clearTimeout(slowTimer); slowTimer = null; } };
    let pendingSeek: number | null = null;
    let lastRetryPos = 0;
    const clearStall = () => { if (stallTimer !== null) { window.clearTimeout(stallTimer); stallTimer = null; } };
    let waitingOnline = false;
    const scheduleRecover = (reason: string): boolean => {
      if (isHls) return false;
      // Browser is offline: do not burn the retry budget on attempts that cannot succeed.
      // Remember the position and resume when the `online` event fires.
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        if (!waitingOnline) {
          waitingOnline = true;
          if (retryTimer !== null) { window.clearTimeout(retryTimer); retryTimer = null; }
          lastRetryPos = media.currentTime || lastRetryPos || 0;
          pendingSeek = lastRetryPos > 1 ? lastRetryPos : null;
          reportTelemetry({ event: "playback.offline_wait", ...fx().eventMeta(), reason, positionSeconds: Math.round(lastRetryPos) });
        }
        setStatusText("Offline — will resume when the connection returns");
        return true;
      }
      if (retries >= RECOVER_DELAYS_MS.length) return false;
      if (retryTimer !== null) return true;
      const attempt = retries + 1;
      const delay = RECOVER_DELAYS_MS[retries];
      retries = attempt;
      lastRetryPos = media.currentTime || 0;
      pendingSeek = lastRetryPos > 1 ? lastRetryPos : null;
      setStatusText(`Reconnecting… (${attempt}/${RECOVER_DELAYS_MS.length})`);
      reportTelemetry({ event: "playback.recover", ...fx().eventMeta(), reason, attempt, positionSeconds: Math.round(lastRetryPos) });
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        if (mediaRef.current !== media) return;
        media.load(); // same src: the proxy returns a fresh slice (new node if needed)
        if (media.readyState < 1) armStart();
      }, delay);
      return true;
    };
    // A source that never produces metadata (upstream hung, proxy slice never answered) used to leave "Loading…" for ever.
    const armStart = () => {
      if (isHls) return;
      clearStart();
      startTimer = window.setTimeout(() => {
        startTimer = null;
        if (mediaRef.current !== media || media.readyState >= 1) return;
        if (!scheduleRecover("start-timeout")) {
          setStatusText("Failed to load — the source did not respond (timed out)");
          reportTelemetry({ event: "media.unavailable", ...fx().eventMeta(), reason: "start_timeout", waitedSeconds: Math.round(WAIT_BUDGET_MS / 1000) });
        }
      }, START_WATCHDOG_MS);
    };
    const onWaiting = () => {
      waitingForDataRef.current = true;
      setStatusText("Buffering…");
      // Do NOT restart a pending timer on every 'waiting' event: repeated events would keep pushing it back and it could never fire.
      if (stallTimer !== null) return;
      stallTimer = window.setTimeout(() => {
        stallTimer = null;
        if (media.readyState < 1) return; // first byte still pending: the 108 s start watchdog owns this wait
        if (media.paused || media.readyState >= 3 && media.currentTime > 0 && !media.seeking && media.networkState !== 2) return;
        if (!scheduleRecover("stall-watchdog")) {
          // Out of retries: say so (it used to stay on "Buffering…" for ever).
          setStatusText("Failed to load — the source stopped responding");
          reportTelemetry({ event: "media.unavailable", ...fx().eventMeta(), reason: "stall_watchdog_exhausted" });
        }
      }, STALL_WATCHDOG_MS);
    };
    const onProgressOk = () => {
      recordArchivePlaybackProgress(activeSrc, media.currentTime);
      clearStall();
      if (retries > 0 && media.currentTime > lastRetryPos + RECOVERED_AFTER_SECONDS) retries = 0;
      if (slowRetried && media.currentTime > lastRetryPos + RECOVERED_AFTER_SECONDS) slowRetried = false;
    };
    const onOnline = () => {
      if (!waitingOnline || mediaRef.current !== media) return;
      waitingOnline = false;
      retries = 0;
      reportTelemetry({ event: "playback.online_resume", ...fx().eventMeta(), positionSeconds: Math.round(lastRetryPos) });
      scheduleRecover("online");
    };
    const onOffline = () => {
      // Offline while buffering/stalled: stop the watchdog from counting this as a failure.
      if (!media.paused && media.readyState < 3) scheduleRecover("offline");
    };
    // A seek into a part that is not buffered is a normal wait (Archive can take several seconds to the first byte), not a stall.
    const onSeeking = () => { waitingForDataRef.current = false; setStatusText("Seeking…"); };
    const onStalled = () => { waitingForDataRef.current = true; setStatusText(media.seeking ? "Seeking…" : "Network stalled…"); };
    const onPause = () => {
      waitingForDataRef.current = false;
      hasStartedPlaybackRef.current = false;
      setIsPlaying(false);
      fx().saveResumePosition(media);
      reportTelemetry({ event: "playback.paused", ...eventMeta() });
      fx().onPauseEvent?.();
    };
    const onEnded = () => {
      waitingForDataRef.current = false;
      hasStartedPlaybackRef.current = false;
      handoffUntilRef.current = Date.now() + 4000;
      setIsPlaying(false);
      playingReportedRef.current = false;
      fx().clearResumePosition();
      reportTelemetry({ event: "playback.ended", ...eventMeta() });
      window.setTimeout(() => fx().onProgramEnded?.(), 0);
    };
    const onError = async () => {
      waitingForDataRef.current = false;
      hasStartedPlaybackRef.current = false;
      const err = media.error;
      clearStall(); clearStart(); clearSlow();
      // Transient failures (dropped slice, 5xx from the proxy, network blip) are retried
      // in place first. Definite failures (restricted, removed, not streamable) skip at once.
      const failedSrc0 = media.currentSrc || activeSrc;
      let definite = false;
      let overloaded: ProxyErrorBody | null = null;
      let slow: ProxyErrorBody | null = null;
      let proxyFailure: ProxyErrorBody | null = null;
      const diagnosticUrl = failedSrc0 ? archiveFailureDiagnosticUrl(failedSrc0) : null;
      if (diagnosticUrl) {
        try {
          const r = await fetch(diagnosticUrl, { cache: "no-store", headers: { Accept: "application/json" } });
          const body = (await r.json().catch(() => ({}))) as ProxyErrorBody;
          if (r.status !== 404) proxyFailure = body;
          const kind = classifyArchiveFailure(r.status, body);
          definite = kind === "definite";
          if (kind === "overloaded") overloaded = body;
          if (kind === "slow") slow = body;
        } catch { /* proxy unreachable: treat as transient */ }
      }
      if (slow) {
        if (!slowRetried) {
          slowRetried = true;
          if (mediaRef.current !== media) return;
          setStatusText("Archive storage server is slow to respond…");
          reportTelemetry({
            event: "playback.slow_wait", ...eventMeta(),
            reason: slow.errorCode ?? "archive_slow",
            proxyRequestId: slow.proxyRequestId ?? null,
          });
          lastRetryPos = media.currentTime || lastRetryPos || 0;
          pendingSeek = lastRetryPos > 1 ? lastRetryPos : null;
          slowTimer = window.setTimeout(() => {
            slowTimer = null;
            if (mediaRef.current !== media) return;
            media.load();
            if (media.readyState < 1) armStart();
          }, 25_000);
          return;
        }
        if (mediaRef.current !== media) return;
        setStatusText("Unavailable — this Archive storage server isn't responding. Skipping…");
        reportTelemetry({
          event: "media.error", ...eventMeta(), mediaErrorCode: err?.code ?? null,
          mediaErrorMessage: err?.message ?? null, readyState: media.readyState, networkState: media.networkState,
          proxyRequestId: slow.proxyRequestId ?? null,
        });
        reportTelemetry({
          event: "media.unavailable", ...fx().eventMeta(), httpStatus: slow.upstreamStatus ?? 0,
          reason: slow.errorCode ?? "archive_slow_storage", proxyRequestId: slow.proxyRequestId ?? null,
        });
        fx().onErrorEvent?.(err, proxyFailure);
        return;
      }
      if (overloaded) {
        // The proxy already tried Archive 3 times. Retrying again only piles on; say what is happening, once.
        if (mediaRef.current !== media) return;
        setStatusText(`Unavailable — ${overloadedMessage(overloaded)}. Skipping…`);
        reportTelemetry({
          event: "media.error", ...eventMeta(), mediaErrorCode: err?.code ?? null,
          mediaErrorMessage: err?.message ?? null, readyState: media.readyState, networkState: media.networkState,
          proxyRequestId: overloaded.proxyRequestId ?? null,
        });
        reportTelemetry({
          event: "media.unavailable", ...fx().eventMeta(), httpStatus: overloaded.upstreamStatus ?? 0,
          reason: overloaded.errorCode ?? "archive_overloaded", proxyRequestId: overloaded.proxyRequestId ?? null,
        });
        fx().onErrorEvent?.(err, proxyFailure);
        return;
      }
      // A CORS-mode load of a verified podcast failed (a tracker hop dropped its CORS headers): play the same file
      // natively once. The signal meter then shows its honest "no signal" state; nothing is faked.
      if (err?.code === 4 && media.crossOrigin && activeSrc && !activeSrc.includes(NO_METER_MARK) && (podcastAllowsMeter(nowPlayingRef.current?.programId) || liveRadioAllowsMeter(nowPlayingRef.current?.programId))) {
        reportTelemetry({ event: "playback.cors_fallback", ...eventMeta() });
        setStatusText("Loading… (signal meter unavailable for this file)");
        setActiveSrc(`${activeSrc}${NO_METER_MARK}`);
        return;
      }
      // Podcast enclosures chain through tracker hosts (podtrac, pdst, chrt, mgln, pscrb...). If the browser or network
      // blocks one, the element fails at once with code 4. Ask the server to walk the SAME chain (trackers still count the
      // download) and play the signed CDN URL directly. Announced in the status line; never silent.
      const podId = nowPlayingRef.current?.programId ?? "";
      if (err?.code === 4 && podId.startsWith("pod-") && activeSrc && activeSrc.startsWith("https://") && !activeSrc.includes(RESOLVED_MARK)) {
        const original = activeSrc.split("#")[0];
        setStatusText("Loading… (resolving the redirect chain on the server)");
        try {
          const r = await fetch(`/api/podcast/resolve?url=${encodeURIComponent(original)}`);
          if (r.ok && mediaRef.current === media) {
            const body = await r.json();
            if (typeof body?.url === "string" && body.url.startsWith("https://")) {
              reportTelemetry({ event: "playback.podcast_resolved", ...eventMeta(), resolvedHost: new URL(body.url).hostname });
              setActiveSrc(`${body.url}${RESOLVED_MARK}`);
              return;
            }
          }
        } catch { /* fall through to the normal failure path */ }
      }
      if (!definite && mediaRef.current === media && scheduleRecover(`media-error-${err?.code ?? "none"}`)) return;

      // No silent switch to direct archive.org: that bypassed proxy validation,
      // retries and telemetry, and a cross-origin source silences the audio chain.
      // A failure is shown as a failure.
      const unavailableReason = proxyFailure?.reason === "UNPLAYABLE_ARCHIVE_MEMBER"
        ? "file is inside a compressed archive (not streamable)"
        : proxyFailure?.upstreamStatus === 429 ? "Archive is rate-limiting (429), try again shortly"
        : proxyFailure?.upstreamStatus === 403 ? "restricted by Archive (403)"
        : proxyFailure?.upstreamStatus === 404 ? "not available on Archive (404)"
        : proxyFailure?.error ?? null;
      if (proxyFailure) {
        setStatusText(`Unavailable — ${unavailableReason ?? "Archive could not provide this media"}.`);
        reportTelemetry({
          event: "media.unavailable", ...fx().eventMeta(),
          httpStatus: proxyFailure.upstreamStatus ?? 0,
          reason: proxyFailure.errorCode ?? "archive_proxy_failure",
          proxyRequestId: proxyFailure.proxyRequestId ?? null,
        });
      } else {
        setStatusText(`Failed to load — ${err ? `code ${err.code}: ${err.message || "no message"}` : "upstream error"}`);
      }
      reportTelemetry({
        event: "media.error",
        ...eventMeta(),
        mediaErrorCode: err?.code ?? null,
        mediaErrorMessage: err?.message ?? null,
        readyState: media.readyState,
        networkState: media.networkState,
        proxyRequestId: proxyFailure?.proxyRequestId ?? null,
      });
      fx().onErrorEvent?.(err, proxyFailure);
    };

    // Mute toggled outside this player (Radio dock, headset): keep this player's state and the next track's muted flag in line.
    const onVolumeChange = () => { if (media.muted !== isMutedRef.current) { isMutedRef.current = media.muted; sessionUnmuted = !media.muted; setIsMuted(media.muted); } };
    media.addEventListener("volumechange", onVolumeChange);
    media.addEventListener("loadedmetadata", onLoadedMetadata);
    media.addEventListener("canplay", onCanPlay);
    media.addEventListener("play", onPlay);
    media.addEventListener("playing", onPlaying);
    media.addEventListener("timeupdate", onTimeUpdate);
    media.addEventListener("waiting", onWaiting);
    media.addEventListener("stalled", onStalled);
    media.addEventListener("seeking", onSeeking);
    media.addEventListener("pause", onPause);
    media.addEventListener("ended", onEnded);
    media.addEventListener("error", onError);

    const saveOnExit = () => fx().saveResumePosition(media);
    window.addEventListener("pagehide", saveOnExit);
    // Mobile browsers often kill a hidden tab without firing pagehide: flush the spot when the tab is hidden too.
    const saveOnHidden = () => { if (document.visibilityState === "hidden") fx().saveResumePosition(media); };
    document.addEventListener("visibilitychange", saveOnHidden);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    // Event-independent stall check: a pending request with no error raises no event, so the timers above never arm.
    // Live radio waits 8 s (a stream that has not produced audio by then is not coming), everything else 20 s.
    const liveRadio = String(nowPlayingRef.current?.programId ?? "").includes(":live:");
    const progressWd = isHls ? null : createProgressWatchdog({
      stallMs: liveRadio ? 8_000 : 20_000,
      sample: () => ({ wantsPlay: !media.paused && !media.ended, readyState: media.readyState, currentTime: media.currentTime || 0, bufferedEnd: media.buffered.length ? media.buffered.end(media.buffered.length - 1) : 0 }),
      onStall: () => {
        if (mediaRef.current !== media) return;
        if (media.readyState < 1 && !liveRadio) return; // no metadata yet: the start watchdog (108 s) decides, not this 20 s check
        reportTelemetry({ event: "playback.stall_detected", ...fx().eventMeta(), reason: "progress-watchdog", readyState: media.readyState, networkState: media.networkState });
        if (!scheduleRecover("progress-watchdog")) {
          setStatusText("Failed to load — the source stopped responding");
          reportTelemetry({ event: "media.unavailable", ...fx().eventMeta(), reason: "progress_watchdog_exhausted" });
        }
      },
    });
    const sampleBufferGauge = () => {
      const currentTime = media.currentTime;
      if (!hasStartedPlaybackRef.current || !Number.isFinite(currentTime) || currentTime < 0) return;
      const snapshot = bufferGaugeRef.current.push({
        t: bufferClockNowMs(),
        currentTime,
        bufferedEnd: bufferedEndAt(media),
        readyState: media.readyState,
        paused: media.paused || media.ended,
        waiting: waitingForDataRef.current,
      });
      setBufferGaugeSnapshot(snapshot);
      const item = nowPlayingRef.current;
      reportBufferSample({
        currentTime,
        playing: !media.paused && !media.ended,
        snapshot,
        programId: item?.programId ?? null,
        mediaPath: item?.archivePath ?? media.currentSrc ?? activeSrc ?? null,
      });
    };
    const progressTimer = progressWd ? window.setInterval(() => {
      progressWd.tick();
      sampleBufferGauge();
    }, 1000) : null;
    const deferred = !isVideo && media.preload === "none";
    if (deferred) {
      // Nothing was requested on purpose: say so instead of leaving "Loading…", and do not time it out.
      setStatusText("Ready — tap Play to resume");
      setAutoplayBlocked(true);
    } else if (!(adopted && media.readyState >= 1)) armStart();
    // Metadata of an adopted element arrived before these listeners existed: run the same start path now.
    if (adopted && media.readyState >= 1) {
      reportTelemetry({ event: "playback.preload_swap", ...fx().eventMeta(), readyState: media.readyState });
      onLoadedMetadata();
    }

    return () => {
      if (progressTimer !== null) window.clearInterval(progressTimer);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      clearSlow();
      clearStall();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      media.removeEventListener("volumechange", onVolumeChange);
      clearStart();
      media.removeEventListener("loadedmetadata", onLoadedMetadata);
      media.removeEventListener("canplay", onCanPlay);
      media.removeEventListener("play", onPlay);
      media.removeEventListener("playing", onPlaying);
      media.removeEventListener("timeupdate", onTimeUpdate);
      media.removeEventListener("waiting", onWaiting);
      media.removeEventListener("stalled", onStalled);
      media.removeEventListener("seeking", onSeeking);
      media.removeEventListener("pause", onPause);
      media.removeEventListener("ended", onEnded);
      media.removeEventListener("error", onError);
      window.removeEventListener("pagehide", saveOnExit);
      document.removeEventListener("visibilitychange", saveOnHidden);
      fx().saveResumePosition(media);
      // Element unmounted or swapped (video <-> audio): release its network/decoder
      // so exactly one playback pipeline remains. Not on a plain src change —
      // React has already set the new src on this same element.
      if (mediaRef.current !== media && !media.isConnected) {
        media.pause();
        media.removeAttribute("src");
        media.load();
      }
    };
  // Deliberately keyed on the source only: re-running calls load(), which
  // aborts any play() in flight ("interrupted by a new load request").
  }, [activeSrc, isVideo]);

  // HLS (.m3u8): native where the browser supports it (Safari), otherwise hls.js.
  // Teardown order is fixed: stopLoad -> detachMedia -> destroy -> null. Skipping
  // it leaves SourceBuffers and loaders running and memory grows on long sessions.
  useEffect(() => {
    const media = mediaRef.current;
    if (!media || !isHls) return;
    // Prefer hls.js wherever it works. Recent desktop Chrome also claims native
    // HLS, but its demuxer fails on ad-stitched, AES-128 streams (Pluto:
    // PipelineStatus::DEMUXER_ERROR_COULD_NOT_PARSE). Native only as fallback (iOS).
    if (!Hls.isSupported() && media.canPlayType("application/vnd.apple.mpegurl")) {
      media.src = activeSrc;
      return;
    }
    if (!Hls.isSupported()) {
      setStatusText("Failed to load — this browser cannot play HLS streams");
      return;
    }
    // Fail fast on dead live channels (hls.js defaults: 10 s timeouts x up to 4 level retries = 40 s+ of black screen),
    // and fetch the first segment while the level playlist loads so good channels start sooner.
    const hls = new Hls({
      liveDurationInfinity: true, lowLatencyMode: false, backBufferLength: 30,
      manifestLoadingTimeOut: 7000, manifestLoadingMaxRetry: 1, manifestLoadingRetryDelay: 500,
      levelLoadingTimeOut: 7000, levelLoadingMaxRetry: 1, levelLoadingRetryDelay: 500,
      startFragPrefetch: true,
    });
    const hlsProbeWindow = window as Window & {
      __ajnHlsProbeEnabled?: boolean;
      __ajnHlsInstance?: Hls;
      __ajnHlsEvents?: Array<Record<string, unknown>>;
    };
    const exposeHlsProbe = import.meta.env.DEV && hlsProbeWindow.__ajnHlsProbeEnabled === true;
    if (exposeHlsProbe) {
      hlsProbeWindow.__ajnHlsInstance = hls;
      hlsProbeWindow.__ajnHlsEvents = [];
      const recordHlsEvent = (event: string, data: unknown) => {
        const row = data && typeof data === "object" ? data as Record<string, unknown> : {};
        const response = row.response && typeof row.response === "object" ? row.response as Record<string, unknown> : {};
        const primitive = (value: unknown): string | number | boolean | null => {
          if (typeof value === "string" || typeof value === "boolean") return value;
          if (typeof value === "number" && Number.isFinite(value)) return value;
          return null;
        };
        const entry = {
          at: Date.now(),
          event,
          type: primitive(row.type),
          details: primitive(row.details),
          fatal: primitive(row.fatal),
          status: primitive(response.code),
          // HLS.js may place a circular loader/fragment object in `reason`.
          // The probe only needs scalar event metadata for serializable reports.
          level: primitive(row.level),
        };
        const events = hlsProbeWindow.__ajnHlsEvents ?? [];
        events.push(entry);
        if (events.length > 2000) events.splice(0, events.length - 2000);
        hlsProbeWindow.__ajnHlsEvents = events;
      };
      hls.on(Hls.Events.ERROR, (_event, data) => recordHlsEvent("ERROR", data));
      hls.on(Hls.Events.MANIFEST_LOADED, (_event, data) => recordHlsEvent("MANIFEST_LOADED", data));
      hls.on(Hls.Events.LEVEL_LOADED, (_event, data) => recordHlsEvent("LEVEL_LOADED", data));
      hls.on(Hls.Events.BUFFER_RESET, (data) => recordHlsEvent("BUFFER_RESET", data));
    }
    hlsRef.current = hls;
    let recoveries = 0;
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      // One recovery attempt per kind before reporting a real failure.
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && recoveries < 2) { recoveries++; hls.startLoad(); return; }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && recoveries < 2) { recoveries++; hls.recoverMediaError(); return; }
      setStatusText(`Failed to load — HLS ${data.type}: ${data.details}`);
      reportTelemetry({ event: "media.error", ...fnRef.current.eventMeta(), hlsType: data.type, hlsDetails: data.details, httpStatus: (data.response as { code?: number } | undefined)?.code ?? null });
      fnRef.current.onErrorEvent?.(null);
    });
    hls.loadSource(activeSrc);
    hls.attachMedia(media);
    return () => {
      if (hlsProbeWindow.__ajnHlsInstance === hls) delete hlsProbeWindow.__ajnHlsInstance;
      hls.stopLoad();
      hls.detachMedia();
      hls.destroy();
      hlsRef.current = null;
    };
  }, [activeSrc, isHls]);

  // OS integration: lock screen, car/Bluetooth (AVRCP) buttons, headset and keyboard media keys.
  // Handlers are registered ONCE and read live state through refs, so they are never torn down between tracks
  // (a gap there makes a car head unit lose its controls). Metadata, play state and position are kept current below.
  // Pressing Play (screen or car) on the launch-restored item is the user's choice to hear it: don't keep the app's
  // start-muted default, or the car would resume in silence.
  const unmuteForResume = () => {
    const m = mediaRef.current;
    if (m && m.preload === "none") m.preload = "auto"; // the user asked to play: from here the file may load
    if (!m || !nowPlayingRef.current?.restoredPaused || restoreHandledRef.current) return;
    m.muted = false; sessionUnmuted = true; setIsMuted(false);
  };
  const sessionRef = useRef({ onPrev, onNext, resumeAudioContext, unmuteForResume });
  sessionRef.current = { onPrev, onNext, resumeAudioContext, unmuteForResume };
  useEffect(() => {
    const ms = typeof navigator !== "undefined" ? navigator.mediaSession : undefined;
    if (!ms) return;
    const media = () => mediaRef.current;
    const seek = (delta: number) => { const m = media(); if (m && Number.isFinite(m.duration)) m.currentTime = Math.max(0, Math.min(m.duration, m.currentTime + delta)); };
    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ["play", () => {
        const m = media(); if (!m) return;
        sessionRef.current.unmuteForResume();
        sessionRef.current.resumeAudioContext();
        if (m.ended) { sessionRef.current.onNext?.(); return; }
        void m.play().catch(() => {});
      }],
      ["pause", () => media()?.pause()],
      ["stop", () => media()?.pause()],
      ["seekbackward", (d) => seek(-(d.seekOffset ?? 10))],
      ["seekforward", (d) => seek(d.seekOffset ?? 10)],
      ["seekto", (d) => { const m = media(); if (m && typeof d.seekTime === "number" && Number.isFinite(m.duration)) m.currentTime = Math.max(0, Math.min(m.duration, d.seekTime)); }],
      ["previoustrack", () => { const m = media(); if (m && (m.currentTime > 3 || !sessionRef.current.onPrev)) { m.currentTime = 0; return; } sessionRef.current.onPrev?.(); }],
      ["nexttrack", () => { if (sessionRef.current.onNext) sessionRef.current.onNext(); else fnRef.current.onProgramEnded?.(); }],
    ];
    for (const [action, fn] of handlers) { try { ms.setActionHandler(action, fn); } catch { /* action unsupported */ } }
    return () => { for (const [action] of handlers) { try { ms.setActionHandler(action, null); } catch { /* ignore */ } } };
  }, []);

  // What the car/lock screen shows: title, artist, album and the cover art (absolute URL).
  useEffect(() => {
    const ms = typeof navigator !== "undefined" ? navigator.mediaSession : undefined;
    if (!ms || !activeSrc) return;
    try {
      let art: MediaImage[] | undefined;
      if (artUrl) { try { art = [{ src: new URL(artUrl, window.location.href).href, sizes: "512x512" }]; } catch { /* bad URL: no art */ } }
      ms.metadata = new MediaMetadata({
        title: title || "AJN",
        artist: nowPlaying?.subtitle || nowPlaying?.channelName || "",
        album: nowPlaying?.channelName || "AJN Precision Engineering",
        ...(art ? { artwork: art } : {}),
      });
    } catch { /* MediaMetadata unsupported */ }
  }, [activeSrc, title, nowPlaying?.subtitle, nowPlaying?.channelName, artUrl]);

  // Playing / paused as the OS sees it. Across a track-to-track handoff it stays "playing" so the session is not dropped.
  useEffect(() => {
    const ms = typeof navigator !== "undefined" ? navigator.mediaSession : undefined;
    if (!ms || !activeSrc) return;
    ms.playbackState = isPlaying || Date.now() < handoffUntilRef.current ? "playing" : "paused";
  }, [isPlaying, activeSrc]);

  // Elapsed / total for the car's progress bar. Android extrapolates while playing, so event-driven updates are enough.
  useEffect(() => {
    const ms = typeof navigator !== "undefined" ? navigator.mediaSession : undefined;
    const media = mediaRef.current;
    if (!ms?.setPositionState || !media || isVideo) return;
    let last = 0;
    const update = () => {
      const d = media.duration;
      try {
        if (!Number.isFinite(d) || d <= 0) ms.setPositionState(); // live: no bar
        else ms.setPositionState({ duration: d, position: Math.min(Math.max(0, media.currentTime), d), playbackRate: media.playbackRate || 1 });
      } catch { /* out-of-range values: skip this update */ }
    };
    const throttled = () => { const now = Date.now(); if (now - last > 10_000) { last = now; update(); } };
    const evs = ["loadedmetadata", "durationchange", "seeked", "play", "pause", "ratechange"];
    evs.forEach((e) => media.addEventListener(e, update));
    media.addEventListener("timeupdate", throttled);
    update();
    return () => { evs.forEach((e) => media.removeEventListener(e, update)); media.removeEventListener("timeupdate", throttled); };
  }, [activeSrc, isVideo]);

  const play = async () => {
    const media = mediaRef.current;
    if (!media) return;
    unmuteForResume();
    resumeAudioContext();
    setStatusText("Starting playback…");
    try {
      await media.play();
      if (!media.paused) reportPlaying();
    } catch (error) {
      // A newer load superseded this play(); the new source starts on its own.
      if ((error as DOMException)?.name === "AbortError") return;
      const message = error instanceof Error ? error.message : String(error);
      setStatusText(`Playback failed — ${message}`);
      console.error("[AJN PLAYBACK] play() rejected", {
        src: media.currentSrc,
        error,
        readyState: media.readyState,
        networkState: media.networkState,
        mediaError: media.error,
      });
    }
  };
  const pause = () => mediaRef.current?.pause();

  const resume = async () => {
    const media = mediaRef.current;
    if (!media || resumePosition === null) return;
    try {
      media.currentTime = Math.min(resumePosition, Math.max(0, media.duration - 1));
      setShowResumePrompt(false);
      await media.play();
    } catch (error) {
      console.error("[AJN PLAYBACK] resume() rejected", error);
      setStatusText(`Playback failed — ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const startOver = () => {
    const media = mediaRef.current;
    clearResumePosition();
    if (media) media.currentTime = 0;
    setShowResumePrompt(false);
  };

  // The Resume / Start Over prompt fades out on its own after RESUME_PROMPT_VISIBLE_MS if the viewer has not touched
  // the player (press, key, touch, focus, or hovering the prompt). Playback keeps going from where it is; the saved
  // position is left alone, so the prompt can come back next time.
  useEffect(() => {
    setResumePromptFading(false);
    if (!showResumePrompt) return;
    const root = containerRef.current;
    let stopTimer: (() => void) | null = null;
    const cancel = () => {
      stopTimer?.();
      stopTimer = null;
      setResumePromptFading(false);
      root?.removeEventListener("pointerdown", cancel, true);
      root?.removeEventListener("keydown", cancel, true);
      root?.removeEventListener("touchstart", cancel, true);
      root?.removeEventListener("focusin", cancel, true);
    };
    root?.addEventListener("pointerdown", cancel, true);
    root?.addEventListener("keydown", cancel, true);
    root?.addEventListener("touchstart", cancel, true);
    root?.addEventListener("focusin", cancel, true);
    stopTimer = scheduleResumePromptFade({
      visibleMs: RESUME_PROMPT_VISIBLE_MS,
      fadeMs: RESUME_PROMPT_FADE_MS,
      onFade: () => setResumePromptFading(true),
      onHide: () => { setShowResumePrompt(false); setResumePromptFading(false); },
    });
    return cancel;
  }, [showResumePrompt]);

  const setVolumeLevel = (v: number) => {
    const media = mediaRef.current;
    if (!media) return;
    const next = Math.max(0, Math.min(1, v));
    media.volume = next;
    setVolume(next);
    // Dragging the slider up from silence is an unmute; to 0 is a mute.
    const wantMuted = next === 0;
    if (media.muted !== wantMuted) { media.muted = wantMuted; sessionUnmuted = !wantMuted; setIsMuted(wantMuted); }
  };

  const toggleMute = () => {
    const media = mediaRef.current;
    if (!media) return;
    const nextMuted = !media.muted;
    media.muted = nextMuted;
    sessionUnmuted = !nextMuted;
    setIsMuted(nextMuted);
  };

  // Fullscreen: the player container where the Fullscreen API exists (desktop,
  // Android); the video element's own fullscreen on iOS Safari; otherwise nothing.
  const toggleFullscreen = () => {
    const el = containerRef.current;
    const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      (doc.exitFullscreen ?? doc.webkitExitFullscreen)?.call(doc);
      return;
    }
    const anyEl = el as (HTMLElement & { webkitRequestFullscreen?: () => void }) | null;
    if (anyEl?.requestFullscreen) { anyEl.requestFullscreen().catch(() => {}); return; }
    if (anyEl?.webkitRequestFullscreen) { anyEl.webkitRequestFullscreen(); return; }
    const v = mediaRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    v?.webkitEnterFullscreen?.();
  };
  const fsRef = useRef(toggleFullscreen);
  fsRef.current = toggleFullscreen;
  useEffect(() => {
    const sync = () => setIsFullscreen(Boolean(document.fullscreenElement && containerRef.current && document.fullscreenElement === containerRef.current));
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  // Desktop keyboard shortcuts. Never with Ctrl/Alt/Meta/Shift (browser and OS
  // shortcuts win), never while typing or on a focused control, and only while
  // the player is actually on screen (it stays mounted, hidden, on other pages).
  const keyRef = useRef({ play, pause, toggleMute, isPlaying });
  keyRef.current = { play, pause, toggleMute, isPlaying };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const action = playerKeyAction({
        key: e.key, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, shiftKey: e.shiftKey,
        targetTag: t?.tagName, targetType: (t as HTMLInputElement | null)?.type, editable: !!t?.isContentEditable, defaultPrevented: e.defaultPrevented,
      });
      if (!action) return;
      const box = containerRef.current;
      const media = mediaRef.current;
      if (!box || !media || box.offsetParent === null && !document.fullscreenElement) return;
      const k = keyRef.current;
      const seekable = Number.isFinite(media.duration) && media.duration > 0;
      switch (action) {
        case "toggle-play": k.isPlaying ? k.pause() : void k.play(); break;
        case "toggle-mute": k.toggleMute(); break;
        case "fullscreen": if (isVideo) fsRef.current(); else return; break;
        case "seek-back": case "seek-forward": {
          if (!seekable) return; // live streams have nothing to seek
          media.currentTime = Math.min(media.duration - 0.5, Math.max(0, media.currentTime + seekDelta(action, e.key, e.shiftKey)));
          break;
        }
        case "volume-up": media.volume = Math.min(1, Math.round((media.volume + 0.1) * 10) / 10); setVolume(media.volume); break;
        case "volume-down": media.volume = Math.max(0, Math.round((media.volume - 0.1) * 10) / 10); setVolume(media.volume); break;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isVideo]);

  const copyBufferLog = useCallback(async () => {
    try {
      if (!navigator.clipboard?.writeText) return false;
      await navigator.clipboard.writeText(JSON.stringify(getBufferSamples(), null, 2));
      return true;
    } catch {
      return false;
    }
  }, []);
  const bufferStatusLine = bufferLine(bufferGaugeSnapshot, isVideo && isPlaying && !isHls);

  return (
    <div>
    {/* containerRef wraps the media stage and overlays so fullscreen shows only the player.
        Audio keeps one media element in audioHostRef. Normal stage: backdrop, visualizer, art.
        Live Radio briefing stage: text panel above a reserved visualizer band; transport stays below. */}
    <div ref={containerRef} className={`relative ${isVideo ? "aspect-video w-full overflow-hidden bg-black" : "flex w-full flex-col overflow-hidden rounded-xl bg-neutral-950"}`}>
      {isVideo ? (
        <video
          key={`${mediaType}:${activeSrc}`}
          ref={(node) => {
            mediaRef.current = node;
            if (node) node.muted = isMuted;
          }}
          src={isHls ? undefined : activeSrc}
          crossOrigin={corsMode}
          autoPlay
          muted={isMuted}
          playsInline
          preload="metadata"
          className="h-full w-full"
        >
          {/* English subtitles (if the Archive item has an English .srt). Off until the viewer turns them on. */}
          {archiveSubtitleUrl(activeSrc) && (
            <track kind="subtitles" srcLang="en" label="English" src={archiveSubtitleUrl(activeSrc) ?? undefined} data-ajn-subtitles="en" />
          )}
        </video>
      ) : (
        <div
          data-testid="audio-stage"
          className={`relative isolate flex ${archiveMusicOn ? "min-h-[18rem] max-h-[60vh] w-full items-center justify-center overflow-hidden bg-slate-950 px-4 py-6 sm:min-h-[22rem] sm:px-8" : `${radioBriefingOn ? "h-96 sm:h-auto sm:aspect-video" : "aspect-video"} max-h-[60vh] min-h-44 w-full items-center justify-center overflow-hidden px-4 py-4`}`}
        >
          {archiveMusicOn ? (
            <>
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0" style={{ background: "radial-gradient(ellipse at center, rgba(8, 145, 178, 0.2), rgba(2, 6, 23, 0.96) 72%)" }} />
              <ArchiveMusicSpectrum analyser={analyserNode} isPlaying={isPlaying} analyzerState={analyzerState} />
              <div className="relative z-[2] mx-auto flex w-full max-w-4xl flex-col items-center justify-center gap-4 sm:flex-row sm:gap-8">
                <div data-testid="audio-art" className="flex h-36 w-36 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-slate-900 shadow-[0_0_45px_rgba(34,211,238,0.24)] ring-2 ring-cyan-200/70 sm:h-52 sm:w-52">
                  {artUrl
                    ? <img src={artUrl} alt="" aria-hidden="true" className="h-full w-full object-cover" />
                    : <span aria-label="Archive music artwork unavailable" role="img" className="text-6xl text-cyan-200">♫</span>}
                </div>
                <div className="min-w-0 max-w-xl text-center sm:text-left">
                  <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-cyan-200">Archive.org Music</p>
                  <h1 data-testid="archive-music-title" title={archiveMusicRawFilename} className="break-words text-xl font-bold leading-tight text-white sm:text-3xl">
                    {archiveMusicTitle}
                  </h1>
                  {archiveMusicArtist && <p data-testid="archive-music-artist" className="mt-2 text-base font-medium text-slate-200 sm:text-lg">{archiveMusicArtist}</p>}
                </div>
              </div>
            </>
          ) : (
            <>
              {artUrl && !radioBriefingOn && (
                <img src={artUrl} alt="" aria-hidden="true" data-testid="audio-backdrop" className="pointer-events-none absolute inset-0 z-0 h-full w-full object-cover opacity-25 blur-md" />
              )}
              {radioBriefingOn && (
                <div
                  role="img"
                  data-testid="radio-visualizer-band"
                  aria-label={analyzerState === "unavailable" ? "Visualizer unavailable for this station; radio audio continues" : "Audio visualizer"}
                  className="pointer-events-none absolute inset-x-0 bottom-0 z-[3] h-10 border-t border-sky-300/20 bg-neutral-950/90"
                />
              )}
              <AudioVisualizerOverlay
                analyser={analyserNode}
                enabled={isPlaying && (radioBriefingOn || visualizerOn)}
                mode={radioBriefingOn ? "audio-briefing" : "audio"}
              />
              {radioBriefingOn && <RadioBriefingPlayerOverlay stationId={nowPlaying?.channelId} />}
              {isPlaying && (
                <div data-testid="on-air-badge" className="pointer-events-none absolute left-3 top-3 z-[3] flex items-center gap-2 rounded bg-black/60 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-white">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" aria-hidden="true" />
                  <span>On air</span>
                  <span data-testid="meter-state" className="font-medium normal-case tracking-normal text-white/60">
                    {analyzerState === "unavailable" ? "no signal meter for this source" : analyzerState === "idle" ? "silence" : "live level"}
                  </span>
                </div>
              )}
              {artUrl && !radioBriefingOn && (
                <div data-testid="audio-art" className="pointer-events-none relative z-[2] aspect-square h-32 max-h-[70%] overflow-hidden rounded-full shadow-2xl ring-2 ring-sky-300/40 sm:h-52">
                  <img src={artUrl} alt="" className="h-full w-full object-cover" />
                </div>
              )}
              {!radioBriefingOn && sideArt.map((img, i) => (
                <div key={img.url} data-testid="audio-side-art" className={`pointer-events-none absolute top-1/2 z-[2] hidden h-20 w-20 -translate-y-1/2 overflow-hidden rounded-full shadow-xl ring-2 ring-white/20 md:block lg:h-24 lg:w-24 ${i === 0 ? "left-[8%]" : "right-[8%]"}`}>
                  <img src={img.url} alt="" className="h-full w-full object-cover" />
                </div>
              ))}
            </>
          )}
          <div ref={audioHostRef} data-testid="audio-host" className="absolute left-0 top-0 h-0 w-0 overflow-hidden" />
        </div>
      )}
      {isVideo && <AudioVisualizerOverlay analyser={analyserNode} enabled={visualizerOn && isPlaying} mode="video" />}
      <WaitingNotes status={statusText} onRetry={onRetry} archive={typeof src === "string" && src.includes("/api/archive/proxy")} />
      {/^(Failed to load|Unavailable)/.test(statusText) && (onRetry || onBackToGuide) && (
        <div role="alert" data-testid="playback-recovery" className="absolute inset-x-3 bottom-14 z-30 flex flex-wrap items-center gap-2 rounded-lg bg-black/85 p-3 text-xs text-white shadow-lg sm:bottom-16">
          <span className="min-w-0 flex-1 basis-40">{statusText}</span>
          {onRetry && <button type="button" onClick={onRetry} data-testid="playback-retry" className="rounded bg-white px-3 py-1.5 font-semibold text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">Retry</button>}
          {onBackToGuide && <button type="button" onClick={onBackToGuide} data-testid="playback-back-to-guide" className="rounded border border-white/40 px-3 py-1.5 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">Back to Guide</button>}
        </div>
      )}
      {autoplayBlocked && (
        <button type="button" onClick={() => void play()} data-testid="autoplay-blocked"
          className="absolute inset-x-3 top-2 z-30 sm:top-3 rounded-lg bg-amber-400 px-4 py-3 text-sm font-semibold text-black shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
          ▶ {autoplayBlockedLabel ?? (nowPlaying?.restoredPaused ? "Resume where you left off — tap Play" : "Ready — tap Play")}
        </button>
      )}
      {showResumePrompt && resumePosition !== null && (
        <div data-testid="resume-prompt" data-fading={resumePromptFading ? "true" : "false"}
          className={`absolute left-3 right-3 top-2 z-30 sm:top-3 flex items-center justify-between gap-3 rounded-lg bg-black/85 p-3 text-white shadow-lg transition-opacity duration-[600ms] motion-reduce:transition-none ${resumePromptFading ? "pointer-events-none opacity-0" : "opacity-100"}`}>
          <span className="text-sm">Resume from {Math.floor(resumePosition / 60)}:{String(Math.floor(resumePosition % 60)).padStart(2, "0")}?</span>
          <div className="flex gap-2">
            <button onClick={resume} className="rounded bg-white px-3 py-1 text-xs font-medium text-black">Resume</button>
            <button onClick={startOver} className="rounded border border-white/40 px-3 py-1 text-xs">Start Over</button>
          </div>
        </div>
      )}
      <PlayerChrome
        mediaRef={mediaRef}
        containerRef={containerRef}
        sourceKey={`${mediaType}:${activeSrc}`}
        isVideo={isVideo}
        isPlaying={isPlaying}
        isMuted={isMuted}
        volume={volume}
        isFullscreen={isFullscreen}
        statusText={statusText}
        title={title}
        channelName={nowPlaying?.channelName}
        subtitle={nowPlaying?.subtitle}
        onTogglePlay={() => void (isPlaying ? pause() : play())}
        onToggleMute={toggleMute}
        onVolume={setVolumeLevel}
        onToggleFullscreen={toggleFullscreen}
        visualizerOn={visualizerOn}
        visualizerLockedOn={radioBriefingOn}
        onToggleVisualizer={() => setVisualizerOn((v) => !v)}
        analyzerState={analyzerState}
        diagnosticsOpen={diagnosticsOpen}
        onToggleDiagnostics={() => setDiagnosticsOpen((v) => !v)}
        thumbnailUrl={radioBriefingOn ? undefined : artUrl}
        onPrev={onPrev}
        onNext={onNext}
        repeatOne={repeatOne}
        onToggleRepeat={isVideo ? undefined : () => setRepeatOne((v) => !v)}
        archiveMusicMode={archiveMusicOn}
        archiveMusicTitle={archiveMusicTitle}
        archiveMusicArtist={archiveMusicArtist}
        archiveMusicRawFilename={archiveMusicRawFilename}
        archiveMusicRecentlyPlayed={archiveMusicRecentlyPlayed}
        archiveMusicUpcoming={archiveMusicUpcoming}
        onResumeRecentlyPlayed={onResumeRecentlyPlayed}
        onSelectUpcoming={onSelectUpcoming}
        isFavorite={isFavorite}
        onToggleFavorite={onToggleFavorite}
      />
    </div>
      {diagnosticsOpen && (
        <div id="audio-bridge-drawer" className="mt-3">
          <AudioBridgeStatus analyser={analyserNode} bufferLine={bufferStatusLine} onCopyBufferLog={copyBufferLog} />
        </div>
      )}
    </div>
  );
}
