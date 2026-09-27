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
  return (
    <aside
      id="persistent-mini-player"
      aria-label="Active Broadcast Mini Player"
      className="fixed bottom-20 md:bottom-6 right-4 sm:right-6 z-50 flex items-center gap-3.5 rounded-2xl border border-neutral-700/80 bg-neutral-900/95 p-3.5 shadow-2xl backdrop-blur-md max-w-sm sm:max-w-md w-auto animate-in slide-in-from-bottom-4 duration-200"
    >
      {/* Icon / Thumbnail */}
      <button
        type="button"
        onClick={onOpenFullPlayer}
        className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400 border border-sky-500/30 transition hover:scale-105 cursor-pointer"
        title="Click to open full player"
      >
        <Tv className="h-5 w-5" />
        <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
        </span>
      </button>

      {/* Stream Titles */}
      <button
        type="button"
        onClick={onOpenFullPlayer}
        className="flex flex-col min-w-0 flex-1 text-left cursor-pointer"
      >
        <span className="text-[10px] font-mono uppercase tracking-wider text-sky-400 truncate">
          {nowPlaying.subtitle || 'Active Broadcast'}
        </span>
        <span className="text-xs font-semibold text-neutral-100 truncate hover:text-sky-300 transition">
          {nowPlaying.title}
        </span>
      </button>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0 pl-1">
        <button
          type="button"
          id="mini-player-expand-btn"
          onClick={onOpenFullPlayer}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-600 text-white transition hover:bg-sky-500 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 cursor-pointer"
          title="Open Full Player"
        >
          <Maximize2 className="h-4 w-4" />
        </button>

        <button
          type="button"
          id="mini-player-close-btn"
          onClick={onDismiss}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 cursor-pointer"
          title="Stop / Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}
