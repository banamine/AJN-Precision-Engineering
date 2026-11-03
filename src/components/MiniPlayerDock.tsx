import { useEffect, useState } from 'react';
import { Play, Pause, Maximize2, X, Tv, Radio, Volume2, VolumeX, RefreshCw } from 'lucide-react';
import { NowPlayingMedia, Destination, PlayProgramCallback } from '../types';
import { AvSyncControls } from './AvSyncControls';
import { findPersistentMedia, usePersistentMedia } from '../hooks/usePersistentMedia';
import { useStationTheme } from '../utils/stationArt';
import { StationIcon } from './StationBanner';

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
  const [volumeOpen, setVolumeOpen] = useState(false);
  const isAudio = nowPlaying.mediaType === 'audio';
  const isLive = isLiveDockItem(nowPlaying);
  const canSeek = !isLive && Number.isFinite(duration) && duration > 0;
  const theme = useStationTheme(nowPlaying.channelId, nowPlaying.title); // live radio: the station's logo and colours

  // Read status and volume from the existing authoritative media element; do not create another player.
  useEffect(() => {
    let media: HTMLMediaElement | null = null;
    let waiting = false;
    const read = () => {
      if (!media) {
        setPlaybackStatus('paused');
        return;
      }
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
      className="ajn-redesign-surface ajn-dock fixed box-border bottom-[calc(4.25rem+env(safe-area-inset-bottom))] sm:bottom-[calc(5rem+env(safe-area-inset-bottom))] md:bottom-6 left-1 right-1 sm:left-auto sm:right-6 sm:w-[calc(100vw-3rem)] sm:max-w-[960px] z-50 flex flex-col items-stretch gap-1 rounded-xl border bg-neutral-900/95 p-1 sm:px-2 shadow-2xl backdrop-blur-md mini-player-dock mini-player-slide-up animate-slide-up animate-in slide-in-from-bottom-4 duration-200"
    >
      <div className="flex w-full min-w-0 flex-nowrap items-center gap-0 sm:gap-2">
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

      <div className="relative flex h-12 min-w-0 flex-1 flex-col justify-center px-0.5">
        <span title={nowPlaying.title} className="truncate text-[11px] font-semibold leading-tight text-neutral-100">
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
          <span className="truncate text-[9px] leading-tight text-neutral-400">
            {nowPlaying.subtitle || 'Active broadcast'}
          </span>
        )}
      </div>

      <span
        data-testid="dock-status"
        data-status={playbackStatus}
        role="status"
        className={`shrink-0 rounded-full border px-1.5 py-1 font-mono text-[8px] font-bold uppercase leading-none tracking-wide ${
          isLive && playbackStatus === 'playing'
            ? 'ajn-dock-status-live'
            : playbackStatus === 'failed'
              ? 'border-red-700/70 bg-red-950/60 text-red-200'
              : playbackStatus === 'buffering'
                ? 'border-amber-700/60 bg-amber-950/50 text-amber-200'
                : 'border-[var(--ajn-line)] bg-[var(--ajn-base)] text-neutral-300'
        }`}
      >
        {isLive && playbackStatus === 'playing' ? 'LIVE' : playbackStatus}
      </span>

      {/* Actions */}
      <div className="relative flex shrink-0 items-center gap-0.5 sm:gap-1">
        <button
          type="button"
          id="mini-player-toggle-btn"
          onClick={togglePlay}
          aria-label={playbackStatus === 'failed' ? `Retry ${nowPlaying.title}` : paused ? `Play ${nowPlaying.title}` : `Pause ${nowPlaying.title}`}
          title={playbackStatus === 'failed' ? 'Retry' : paused ? 'Play' : 'Pause'}
          className={`ajn-dock-control flex h-11 min-h-[44px] items-center justify-center rounded-lg transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 cursor-pointer touch-manipulation ${
            playbackStatus === 'failed'
              ? 'min-w-[56px] gap-1 bg-amber-700 px-1 text-white hover:bg-amber-600 sm:min-w-[68px] sm:gap-1.5 sm:px-2'
              : 'w-11 min-w-[44px]'
          }`}
        >
          {playbackStatus === 'failed'
            ? <><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /><span className="text-[11px] font-semibold">Retry</span></>
            : paused
              ? <Play className="ml-0.5 h-4 w-4 fill-current" />
              : <Pause className="h-4 w-4" />}
        </button>
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
          onClick={onOpenFullPlayer}
          aria-label="Open Full Player"
          title="Open Full Player"
          className="ajn-dock-expand flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-lg transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 cursor-pointer touch-manipulation"
        >
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
      <div className="w-full basis-full px-1 empty:hidden">
        <AvSyncControls nowPlaying={nowPlaying} onPlay={onPlayProgram} onNavigate={onNavigate} variant="compact" />
      </div>
    </aside>
  );
}
