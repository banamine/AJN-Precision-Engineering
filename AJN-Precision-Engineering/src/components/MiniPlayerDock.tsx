import { useEffect, useState } from 'react';
import { Play, Pause, Maximize2, X, Tv, Radio } from 'lucide-react';
import { NowPlayingMedia, Destination } from '../types';

interface MiniPlayerDockProps {
  nowPlaying: NowPlayingMedia;
  onOpenFullPlayer: () => void;
  onDismiss: () => void;
}

export function MiniPlayerDock({
  nowPlaying,
  onOpenFullPlayer,
  onDismiss,
}: MiniPlayerDockProps) {
  // The real player stays mounted (hidden) in #persistent-player; the dock drives it.
  const [paused, setPaused] = useState(true);
  const getMedia = () => {
    if (nowPlaying.mediaType === 'audio') {
      return document.querySelector<HTMLMediaElement>('#persistent-player audio')
        ?? document.querySelector<HTMLMediaElement>('#persistent-player video');
    }
    return document.querySelector<HTMLMediaElement>('#persistent-player video')
      ?? document.querySelector<HTMLMediaElement>('#persistent-player audio');
  };
  useEffect(() => {
    let media: HTMLMediaElement | null = null;
    const sync = () => setPaused(!media || media.paused);
    const attach = () => {
      const next = getMedia();
      if (next === media) return;
      media?.removeEventListener('play', sync); media?.removeEventListener('pause', sync);
      media = next;
      media?.addEventListener('play', sync); media?.addEventListener('pause', sync);
      sync();
    };
    attach();
    const t = window.setInterval(attach, 250); // element is replaced when the source changes
    return () => { window.clearInterval(t); media?.removeEventListener('play', sync); media?.removeEventListener('pause', sync); };
  }, [nowPlaying.src, nowPlaying.mediaType]);
  const togglePlay = () => { const m = getMedia(); if (!m) return; if (m.paused) void m.play().catch(() => {}); else m.pause(); };
  const isAudio = nowPlaying.mediaType === 'audio';
  return (
    <aside
      id="persistent-mini-player"
      aria-label="Active Broadcast Mini Player"
      className="fixed bottom-[4.25rem] sm:bottom-20 md:bottom-6 left-2 right-2 sm:left-auto sm:right-6 sm:w-96 max-w-md z-50 flex items-center gap-2 sm:gap-3 rounded-xl sm:rounded-2xl border border-neutral-700/80 bg-neutral-900/95 p-2 sm:p-3 shadow-2xl backdrop-blur-md mini-player-dock mini-player-slide-up animate-slide-up animate-in slide-in-from-bottom-4 duration-200"
    >
      {/* Icon / Thumbnail */}
      <button
        type="button"
        onClick={onOpenFullPlayer}
        aria-label={`Open full player: ${nowPlaying.title}`}
        title="Click to open full player"
        className="relative flex h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg sm:rounded-xl bg-sky-500/15 text-sky-400 border border-sky-500/30 transition hover:scale-105 active:scale-95 cursor-pointer touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
      >
        {isAudio ? <Radio className="h-5 w-5" /> : <Tv className="h-5 w-5" />}
        <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
        </span>
      </button>

      {/* Stream Titles */}
      <button
        type="button"
        onClick={onOpenFullPlayer}
        aria-label={`Open full player: ${nowPlaying.title}`}
        title={`Open full player: ${nowPlaying.title}`}
        className="flex flex-col justify-center min-w-0 flex-1 text-left cursor-pointer min-h-[44px] py-0.5 px-1 rounded-md touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 active:opacity-80 transition-opacity"
      >
        <span className="text-[9px] sm:text-[10px] font-mono uppercase tracking-wider text-sky-400 truncate leading-tight">
          {nowPlaying.subtitle || 'Active Broadcast'}
        </span>
        <span className="text-xs sm:text-xs font-semibold text-neutral-100 truncate hover:text-sky-300 transition leading-tight">
          {nowPlaying.title}
        </span>
      </button>

      {/* Actions */}
      <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
        <button
          type="button"
          id="mini-player-toggle-btn"
          onClick={togglePlay}
          aria-label={paused ? `Play ${nowPlaying.title}` : `Pause ${nowPlaying.title}`}
          title={paused ? 'Play' : 'Pause'}
          className="flex h-10 w-10 sm:h-8 sm:w-8 min-h-[44px] min-w-[42px] sm:min-h-0 sm:min-w-0 items-center justify-center rounded-lg bg-neutral-800 text-neutral-100 transition hover:bg-neutral-700 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 cursor-pointer touch-manipulation"
        >
          {paused ? <Play className="h-4 w-4 fill-current ml-0.5" /> : <Pause className="h-4 w-4" />}
        </button>
        <button
          type="button"
          id="mini-player-expand-btn"
          onClick={onOpenFullPlayer}
          aria-label="Open Full Player"
          title="Open Full Player"
          className="flex h-10 w-10 sm:h-8 sm:w-8 min-h-[44px] min-w-[42px] sm:min-h-0 sm:min-w-0 items-center justify-center rounded-lg bg-sky-600 text-white transition hover:bg-sky-500 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 cursor-pointer touch-manipulation"
        >
          <Maximize2 className="h-4 w-4" />
        </button>

        <button
          type="button"
          id="mini-player-close-btn"
          onClick={onDismiss}
          aria-label="Stop and Dismiss Mini Player"
          title="Stop / Dismiss"
          className="flex h-10 w-10 sm:h-8 sm:w-8 min-h-[44px] min-w-[42px] sm:min-h-0 sm:min-w-0 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-200 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 cursor-pointer touch-manipulation"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}
