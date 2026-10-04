// "Watch" / "Mini video" / "Listen" buttons for AJN episodes that have a paired other-media version.
// Renders nothing when there is no verified twin, so non-AJN playback is untouched.
import { Headphones, PictureInPicture, Tv } from 'lucide-react';
import type { Destination, NowPlayingMedia, PlayProgramCallback } from '../types';
import { useAvSwitch } from '../hooks/useAvSync';

interface Props {
  nowPlaying: NowPlayingMedia | null | undefined;
  onPlay: PlayProgramCallback | undefined;
  onNavigate?: (destination: Destination) => void;
  /** 'panel' uses the Radio page styles (.ajr-sync-btn); 'compact' is for the dock and Player page. */
  variant: 'panel' | 'compact';
}

export function AvSyncControls({ nowPlaying, onPlay, onNavigate, variant }: Props) {
  const { twin, miniOpen, canMini, hardSwitch, toggleMini } = useAvSwitch(nowPlaying, onPlay, onNavigate);
  if (!twin) return null;
  const cls = variant === 'panel'
    ? 'ajr-sync-btn'
    : 'inline-flex items-center gap-1 rounded-lg bg-neutral-800 px-2.5 py-1.5 text-[11px] font-semibold text-neutral-100 transition hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400';
  const wrap = variant === 'panel' ? 'ajr-sync' : 'flex flex-wrap items-center gap-1.5';
  return (
    <div className={wrap} data-testid="av-sync-controls" role="group" aria-label="Switch between audio and video at the same position">
      <button type="button" className={cls} data-testid={twin.target === 'video' ? 'av-watch' : 'av-listen'} onClick={hardSwitch}
        aria-label={twin.target === 'video' ? 'Watch the video version from here' : 'Listen to the audio version from here'}>
        {twin.target === 'video' ? <><Tv size={12} /> WATCH</> : <><Headphones size={12} /> LISTEN</>}
      </button>
      {canMini && (
        <button type="button" className={cls} data-testid="av-mini" aria-pressed={miniOpen} onClick={toggleMini}
          aria-label={miniOpen ? 'Close mini video' : 'Open the video in a mini player while the audio keeps playing'}>
          <PictureInPicture size={12} /> {miniOpen ? 'CLOSE MINI VIDEO' : 'MINI VIDEO'}
        </button>
      )}
    </div>
  );
}
