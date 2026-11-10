import { useEffect, useState } from 'react';
import { Play, Pause, Maximize2, X, Tv, Radio, Volume2, VolumeX, RefreshCw, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { NowPlayingMedia, Destination, PlayProgramCallback } from '../types';
import { AvSyncControls } from './AvSyncControls';
import { findPersistentMedia, usePersistentMedia } from '../hooks/usePersistentMedia';
import { useStationTheme } from '../utils/stationArt';
import { StationIcon } from './StationBanner';
import { listRadioPresets, pickAdjacentStation } from '../utils/radioPresets';
import { registerLiveRadioMeter } from '../utils/mediaRoute';
import { requestRadioDock } from '../utils/radioDock';
import { bufferAheadSeconds, dockStatusLabel, isReconnecting } from '../utils/bufferAhead';
import { RumbleLiveBadge } from './RumbleLiveBadge';

interface MiniPlayerDockProps {
  nowPlaying: NowPlayingMedia;
  onOpenFullPlayer: () => void;
  onDismiss: () => void;
  /** Optional: enables Watch / Mini video / Listen for AJN episodes that have a paired version. */
  onPlayProgram?: PlayProgramCallback;
  onNavigate?: (destination: Destination) => void;
}

type DockPlaybackStatus = 'playing' | 'paused' | 'buffering' | 'failed';

const isLiveDockItem = (item: NowPlayingMedia) =>
  Boolean(item.isLive)
  || String(item.channelId ?? '').startsWith('radio:')
  || String(item.programId ?? '').includes(':live:');

const formatDockTime = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remainder = whole % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
};

const DOCK_SHELL = "ajn-redesign-surface ajn-dock !h-auto fixed box-border bottom-[calc(4.25rem+env(safe-area-inset-bottom))] sm:bottom-[calc(5rem+env(safe-area-inset-bottom))] md:bottom-0 left-1 right-1 sm:left-auto sm:right-6 sm:w-[calc(100vw-3rem)] sm:max-w-[960px] md:left-0 md:right-0 md:w-full md:max-w-none md:rounded-none md:border-x-0 md:border-b-0 md:px-6 md:py-2 z-50 flex flex-col items-stretch gap-1 rounded-xl border bg-neutral-900/95 p-1 sm:px-2 shadow-2xl backdrop-blur-md mini-player-dock mini-player-slide-up animate-slide-up animate-in slide-in-from-bottom-4 duration-200";

/** The same bottom bar when nothing is playing, so the Radio button always lives in the dock. Play starts the first saved preset; with no presets it opens Radio. */
export function IdleDock({ onPlayProgram }: { onPlayProgram?: PlayProgramCallback }) {
  const start = () => {
    const first = pickAdjacentStation(listRadioPresets(), undefined, 1);
    if (!first || !onPlayProgram) { requestRadioDock('open'); return; }
    if (first.corsVerified) registerLiveRadioMeter(first.channelId);
    onPlayProgram(first.src, first.title, first.subtitle, 'audio', first.channelId, first.guideId ?? 'audio-podcasts', first.programId);
  };
  return (
    <aside id="persistent-mini-player" data-testid="idle-dock" aria-label="Radio dock" className={DOCK_SHELL}>
      <div className="flex w-full min-w-0 flex-nowrap items-center gap-2 md:gap-3">
        <span aria-hidden="true" className="ajn-dock-control flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border"><Radio className="h-5 w-5" /></span>
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-neutral-100 md:w-64 md:flex-none md:text-sm">Radio</span>
        <div className="flex shrink-0 items-center md:flex-1 md:justify-center">
          <button type="button" data-testid="idle-dock-play" onClick={start} aria-label="Play radio" title="Play radio"
            className="ajn-dock-control flex h-12 w-12 min-h-[48px] min-w-[48px] items-center justify-center rounded-lg transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 cursor-pointer touch-manipulation md:rounded-full md:!bg-[var(--ajn-accent)] md:!text-white">
            <Play className="ml-0.5 h-4 w-4 fill-current" />
          </button>
        </div>
        <div className="flex shrink-0 items-center md:flex-1 md:justify-end">
          <div id="radio-dock-slot" data-testid="dock-radio-slot" className="flex h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center" />
        </div>
      </div>
    </aside>
  );
}

export function MiniPlayerDock({
  nowPlaying,
  onOpenFullPlayer,
  onDismiss,
  onPlayProgram,
  onNavigate,
}: MiniPlayerDockProps) {
  // The real player stays mounted (hidden) in #persistent-player; the dock drives it through the shared hook.
  const { paused, muted, currentTime, duration, toggle: togglePlay, toggleMute, seek } =
    usePersistentMedia(nowPlaying.mediaType, `${nowPlaying.src}|${nowPlaying.mediaType}`);
  const [playbackStatus, setPlaybackStatus] = useState<DockPlaybackStatus>('paused');
  const [volume, setVolume] = useState(1);
  const [aheadSeconds, setAheadSeconds] = useState(0);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const isAudio = nowPlaying.mediaType === 'audio';
  const isLive = isLiveDockItem(nowPlaying);
  const canSeek = !isLive && Number.isFinite(duration) && duration > 0;
  const theme = useStationTheme(nowPlaying.channelId, nowPlaying.title); // live radio: the station's logo and colours
  const isRadio = String(nowPlaying.channelId ?? '').startsWith('radio:');
  // Prev / Next walk the saved radio presets with the same helper the tuning knob uses.
  const stepStation = (dir: 1 | -1) => {
    const next = pickAdjacentStation(listRadioPresets(), nowPlaying.channelId, dir);
    if (!next || !onPlayProgram) return;
    if (next.corsVerified) registerLiveRadioMeter(next.channelId);
    onPlayProgram(next.src, next.title, next.subtitle, 'audio', next.channelId, next.guideId ?? 'audio-podcasts', next.programId);
  };

  // Read status and volume from the existing authoritative media element; do not create another player.
  useEffect(() => {
    let media: HTMLMediaElement | null = null;
    let waiting = false;
    const read = () => {
      if (!media) {
        setPlaybackStatus('paused');
        return;
      }
      const ahead = Math.floor(bufferAheadSeconds(media));
      setAheadSeconds((previous) => previous === ahead ? previous : ahead);
      const attempt = Number(media.dataset.reconnect) || 0;
      setReconnectAttempt((previous) => previous === attempt ? previous : attempt);
      const nextVolume = Number.isFinite(media.volume) ? media.volume : 1;
      setVolume((previous) => previous === nextVolume ? previous : nextVolume);
      const nextStatus: DockPlaybackStatus = media.error
        ? 'failed'
        : media.paused
          ? 'paused'
          : waiting || media.readyState < HTMLMediaElement.HAVE_FUTURE_DATA
            ? 'buffering'
            : 'playing';
      setPlaybackStatus((previous) => previous === nextStatus ? previous : nextStatus);
    };
    const onWaiting = () => { waiting = true; read(); };
    const onReady = () => { waiting = false; read(); };
    const onError = () => setPlaybackStatus('failed');
    const events: Array<[keyof HTMLMediaElementEventMap, EventListener]> = [
      ['play', onReady], ['playing', onReady], ['canplay', onReady], ['loadeddata', onReady],
      ['waiting', onWaiting], ['stalled', onWaiting], ['pause', read], ['error', onError],
      ['emptied', read], ['volumechange', read],
    ];
    const detach = () => {
      if (media) for (const [name, handler] of events) media.removeEventListener(name, handler);
    };
    const attach = () => {
      const next = findPersistentMedia(nowPlaying.mediaType);
      if (next !== media) {
        detach();
        media = next;
        if (media) for (const [name, handler] of events) media.addEventListener(name, handler);
      }
      read();
    };
    attach();
    const timer = window.setInterval(attach, 250);
    return () => { window.clearInterval(timer); detach(); };
  }, [nowPlaying.mediaType, nowPlaying.src]);

  return (
    <aside
      id="persistent-mini-player"
      aria-label="Active Broadcast Mini Player"
      className={DOCK_SHELL}
    >
      <div className="flex w-full min-w-0 flex-nowrap items-center gap-0 sm:gap-2 md:gap-3">
      {/* Icon / Thumbnail */}
      <button
        type="button"
        onClick={onOpenFullPlayer}
        aria-label={`Open full player: ${nowPlaying.title}`}
        title="Click to open full player"
        className="ajn-dock-control relative flex h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg border transition hover:scale-105 active:scale-95 cursor-pointer touch-manipulation focus-visible:outline-none focus-visible:ring-2"
      >
        {theme ? <StationIcon theme={theme} size={44} className="!rounded-lg" /> : isAudio ? <Radio className="h-5 w-5" /> : <Tv className="h-5 w-5" />}
      </button>

      <div className="relative flex h-12 min-w-0 flex-1 flex-col justify-center px-0.5 md:w-64 md:flex-none">
        <span title={nowPlaying.title} className="truncate text-[11px] font-semibold leading-tight text-neutral-100 md:text-sm">
          {nowPlaying.title}
        </span>
        {canSeek ? (
          <div className="relative mt-0.5 flex h-6 min-w-0 flex-col justify-end">
            <div className="mb-0.5 flex min-w-0 items-center justify-between gap-1 font-mono text-[8px] leading-none text-neutral-400">
              <span>{formatDockTime(currentTime)}</span>
              <span>{formatDockTime(duration)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={duration}
              step={1}
              value={Math.min(currentTime, duration)}
              onChange={(event) => seek(Number(event.currentTarget.value))}
              aria-label={`Seek ${nowPlaying.title}`}
              className="ajn-dock-seek w-full accent-[var(--ajn-accent)]"
            />
          </div>
        ) : (
          <span className="flex min-w-0 items-center gap-1.5 text-[9px] leading-tight text-neutral-400">
            <span className="truncate">{nowPlaying.subtitle || 'Active broadcast'}</span>
            <RumbleLiveBadge nowPlaying={nowPlaying} onNavigate={onNavigate} />
          </span>
        )}
      </div>

      <span
        data-testid="dock-status"
        data-status={playbackStatus}
        role="status"
        className={`shrink-0 rounded-full border px-1.5 py-1 font-mono text-[8px] font-bold uppercase leading-none tracking-wide ${
          isReconnecting(playbackStatus, reconnectAttempt)
            ? 'border-amber-700/60 bg-amber-950/50 text-amber-200'
            : isLive && playbackStatus === 'playing'
            ? 'ajn-dock-status-live'
            : playbackStatus === 'failed'
              ? 'border-red-700/70 bg-red-950/60 text-red-200'
              : playbackStatus === 'buffering'
                ? 'border-amber-700/60 bg-amber-950/50 text-amber-200'
                : 'border-[var(--ajn-line)] bg-[var(--ajn-base)] text-neutral-300'
        }`}
      >
        {dockStatusLabel(playbackStatus, isLive, aheadSeconds, reconnectAttempt)}
      </span>

      {/* Transport: Prev / Play / Next sit in the middle of the bar on desktop; on a phone only Play shows here and Prev / Next are the row below */}
      <div className="flex shrink-0 items-center gap-0.5 md:flex-1 md:justify-center md:gap-3">
        {isRadio && (
          <button type="button" data-testid="dock-prev-round" aria-label="Previous station" title="Previous station" onClick={() => stepStation(-1)} className="ajn-dock-control hidden h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[var(--ajn-line)] transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 cursor-pointer md:flex">
            <ChevronsLeft className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          id="mini-player-toggle-btn"
          onClick={togglePlay}
          aria-label={playbackStatus === 'failed' ? `Retry ${nowPlaying.title}` : paused ? `Play ${nowPlaying.title}` : `Pause ${nowPlaying.title}`}
          title={playbackStatus === 'failed' ? 'Retry' : paused ? 'Play' : 'Pause'}
          className={`ajn-dock-control flex h-11 min-h-[44px] items-center justify-center rounded-lg transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 cursor-pointer touch-manipulation ${
            playbackStatus === 'failed'
              ? 'min-w-[56px] gap-1 bg-amber-700 px-1 text-white hover:bg-amber-600 sm:min-w-[68px] sm:gap-1.5 sm:px-2'
              : 'w-11 min-w-[44px] md:h-12 md:w-12 md:rounded-full md:!bg-[var(--ajn-accent)] md:!text-white'
          }`}
        >
          {playbackStatus === 'failed'
            ? <><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /><span className="text-[11px] font-semibold">Retry</span></>
            : paused
              ? <Play className="ml-0.5 h-4 w-4 fill-current" />
              : <Pause className="h-4 w-4" />}
        </button>
        {isRadio && (
          <button type="button" data-testid="dock-next-round" aria-label="Next station" title="Next station" onClick={() => stepStation(1)} className="ajn-dock-control hidden h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[var(--ajn-line)] transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 cursor-pointer md:flex">
            <ChevronsRight className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Actions */}
      <div className="relative flex shrink-0 items-center gap-0.5 sm:gap-1">
        <input type="range" min={0} max={1} step={0.05} value={volume} data-testid="dock-volume-inline" aria-label="Volume"
          onChange={(event) => { const v = Number(event.currentTarget.value); const media = findPersistentMedia(nowPlaying.mediaType); if (media) media.volume = v; setVolume(v); }}
          className="hidden w-24 accent-[var(--ajn-accent)] md:block" />
        <button
          type="button"
          id="mini-player-volume-btn"
          onClick={() => setVolumeOpen((open) => !open)}
          aria-label={muted ? 'Open volume controls (muted)' : 'Open volume controls'}
          aria-expanded={volumeOpen}
          aria-controls="mini-player-volume-popover"
          title="Mute and volume controls"
          className="ajn-dock-control flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-lg transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 cursor-pointer touch-manipulation"
        >
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
        {volumeOpen && (
          <div
            id="mini-player-volume-popover"
            role="group"
            aria-label="Mute and volume controls"
            className="ajn-dock-volume-popover absolute bottom-[calc(100%+8px)] z-[51] flex items-center gap-2 rounded-xl p-2 shadow-xl"
            style={{ right: 'calc(100% - 48px)' }}
          >
            <button
              type="button"
              id="mini-player-mute-btn"
              data-testid="mute-button"
              data-muted={muted ? 'true' : 'false'}
              onClick={toggleMute}
              aria-label={muted ? 'Unmute' : 'Mute'}
              aria-pressed={muted}
              className="ajn-dock-control flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-lg"
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <label className="flex min-h-[44px] items-center gap-2 px-1 text-[10px] font-mono text-neutral-300">
              <span className="sr-only">Volume</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={volume}
                onChange={(event) => {
                  const nextVolume = Number(event.currentTarget.value);
                  const media = findPersistentMedia(nowPlaying.mediaType);
                  if (media) media.volume = nextVolume;
                  setVolume(nextVolume);
                }}
                aria-label="Volume"
                className="w-24 accent-[var(--ajn-accent)]"
              />
              <span>{Math.round(volume * 100)}%</span>
            </label>
          </div>
        )}
        <button
          type="button"
          id="mini-player-expand-btn"
          onClick={isRadio ? () => requestRadioDock('open') : onOpenFullPlayer}
          aria-label={isRadio ? 'Open Radio' : 'Open Full Player'}
          title={isRadio ? 'Open Radio' : 'Open Full Player'}
          className={`ajn-dock-expand flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-lg ${isRadio ? 'md:w-auto md:gap-2 md:border md:border-[var(--ajn-line)] md:px-3' : ''} transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 cursor-pointer touch-manipulation`}
        >
          {isRadio && <span className="hidden text-xs font-semibold md:inline">Expand Deck</span>}
          <Maximize2 className="h-4 w-4" />
        </button>
        <div id="radio-dock-slot" data-testid="dock-radio-slot" className="flex h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center" />
        <button
          type="button"
          id="mini-player-close-btn"
          onClick={onDismiss}
          aria-label="Stop and Dismiss Mini Player"
          title="Stop / Dismiss"
          className="ajn-dock-control flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-lg transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 cursor-pointer touch-manipulation"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      </div>
      {isRadio && (
        <div data-testid="dock-stepper" className="flex w-full basis-full items-center gap-2 px-1 pb-1 md:hidden">
          <button type="button" data-testid="dock-prev" aria-label="Previous station" onClick={() => stepStation(-1)}
            className="ajn-dock-control flex min-h-[48px] flex-1 items-center border border-[var(--ajn-line)] bg-[var(--ajn-card-2)] justify-center gap-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 cursor-pointer touch-manipulation">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" /><span>Prev</span>
          </button>
          <button type="button" data-testid="dock-next" aria-label="Next station" onClick={() => stepStation(1)}
            className="ajn-dock-control flex min-h-[48px] flex-1 items-center border border-[var(--ajn-line)] bg-[var(--ajn-card-2)] justify-center gap-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 cursor-pointer touch-manipulation">
            <span>Next</span><ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="w-full basis-full px-1 empty:hidden">
        <AvSyncControls nowPlaying={nowPlaying} onPlay={onPlayProgram} onNavigate={onNavigate} variant="compact" />
      </div>
    </aside>
  );
}
