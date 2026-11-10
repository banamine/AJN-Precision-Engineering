import type { ReactElement } from 'react';
import type { Destination, NowPlayingMedia } from '../types';

/** True for AJN network audio (Alex Jones / Infowars), whose live video show runs on the Rumble wall.
 *  Deliberately does NOT match "War Room": the AJN network area and Real America's Voice are kept apart. */
export function isAjnLiveItem(item: NowPlayingMedia | null | undefined): boolean {
  if (!item) return false;
  const ids = `${item.channelId ?? ''} ${item.programId ?? ''} ${item.guideId ?? ''}`.toLowerCase();
  if (ids.includes('ajn')) return true;
  return /alex\s*jones|infowars/i.test(item.title ?? '');
}

interface RumbleLiveBadgeProps {
  nowPlaying: NowPlayingMedia | null | undefined;
  onNavigate?: (destination: Destination) => void;
  className?: string;
}

/** Shortcut from AJN audio to the live video show on the Rumble wall. The audio keeps playing; this only changes the page.
 *  It does not claim the show is on air — it is a way in, not a status light. */
export function RumbleLiveBadge({ nowPlaying, onNavigate, className = '' }: RumbleLiveBadgeProps): ReactElement | null {
  if (!onNavigate || !isAjnLiveItem(nowPlaying)) return null;
  const open = () => {
    onNavigate('news');
    try { window.location.hash = 'rumble'; } catch { /* no window: the destination change is enough */ }
  };
  return (
    <button
      type="button"
      data-testid="rumble-live-badge"
      onClick={open}
      title="Open the live video show on the Rumble wall"
      aria-label="Open the live video show on the Rumble wall"
      className={`inline-flex h-5 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-red-500/40 bg-red-950/60 px-2 font-mono text-[10px] text-red-300 transition-colors hover:bg-red-900/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 touch-manipulation ${className}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-red-400" />
      ON RUMBLE
    </button>
  );
}
