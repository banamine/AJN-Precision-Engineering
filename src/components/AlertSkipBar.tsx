import { useRef, type ReactElement, type ReactNode } from 'react';
import type { usePodcastCaptions } from '../hooks/usePodcastCaptions';
import { useAlertHits } from '../utils/alertHitsStore';
import { NUDGE_SECONDS, activeHit, hitsForEpisode, nextHit, prevHit, stepCue, type CueCursor, PENDING_CUE_MS } from '../utils/alertSkip';
import { skipAriaLabel, skipLabel, skipMedia } from '../utils/podcastSkip';

interface Props {
  cap: ReturnType<typeof usePodcastCaptions>;
  getMedia: () => HTMLMediaElement | null;
  /** the playing episode's program id (the same id the alert hits carry) */
  episodeId: string;
  /** extra controls placed at the end of the same row (the captions options) */
  children?: ReactNode;
}

const BTN = 'inline-flex h-8 items-center rounded-md border border-white/20 bg-white/5 px-2 text-[11px] font-bold tabular-nums text-neutral-100 hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:cursor-not-allowed disabled:opacity-40';

/** Skip tools beside the captions: step by caption line, jump between this episode's alert hits, nudge the playhead.
 *  Line and hit jumps go through the caption player's own jump (so a calibrated show lands on the right second); time nudges use skipMedia()
 *  which stacks rapid taps. A press made before the captions catch up with the last jump adds onto it instead of re-reading a stale line. */
export function AlertSkipBar({ cap, getMedia, episodeId, children }: Props): ReactElement {
  const { view } = cap;
  const all = useAlertHits();
  const hits = hitsForEpisode(all, episodeId);
  const cursor = useRef<CueCursor | null>(null);
  const base = (now: number): number => (cursor.current && now - cursor.current.at < PENDING_CUE_MS ? cursor.current.target : view.index);

  const line = (dir: -1 | 1) => {
    const r = stepCue(cursor.current, view.index, dir, view.cues.length, Date.now());
    if (!r) return; cursor.current = r.cursor; cap.jumpTo(r.index);
  };
  const goHit = (h: { cueIndex: number } | null) => { if (!h) return; cursor.current = { target: h.cueIndex, at: Date.now() }; cap.jumpTo(h.cueIndex); };
  /** Picked at press time from the pending target, not from what was drawn: a second quick tap goes on from the first one. */
  const stepHit = (dir: -1 | 1) => { const b = base(Date.now()); goHit(dir > 0 ? nextHit(hits, b) : prevHit(hits, b)); };
  const nudge = (delta: number) => { const m = getMedia(); if (m) skipMedia(m, delta); };

  const now = Date.now(); const at = base(now);
  const prev = prevHit(hits, at); const next = nextHit(hits, at); const here = activeHit(hits, view.index);
  return (
    <div data-testid="alert-skip-bar" role="group" aria-label="Skip tools" className="flex flex-wrap items-center gap-1.5">
      <button type="button" data-testid="skip-prev-cue" className={BTN} aria-label="Previous caption line" onClick={() => line(-1)} disabled={view.index <= 0}>&#9664;&#9664; Line</button>
      <button type="button" data-testid="skip-next-cue" className={BTN} aria-label="Next caption line" onClick={() => line(1)} disabled={view.index >= view.cues.length - 1}>Line &#9654;&#9654;</button>
      {NUDGE_SECONDS.map((s) => <button key={s} type="button" data-testid={`skip-nudge-${s}`} className={BTN} aria-label={skipAriaLabel(s)} onClick={() => nudge(s)}>{skipLabel(s)}</button>)}
      {hits.length > 0 && (
        <span className="ml-1 inline-flex flex-wrap items-center gap-1.5 border-l border-white/15 pl-2" role="group" aria-label="Alert hits in this episode">
          <span className="text-[10px] font-bold uppercase tracking-widest text-amber-200">{hits.length} alert{hits.length === 1 ? '' : 's'}</span>
          <button type="button" data-testid="skip-prev-hit" className={BTN} aria-label="Previous alert hit" onClick={() => stepHit(-1)} disabled={!prev}>&#9664; Alert</button>
          <button type="button" data-testid="skip-return-hit" className={BTN} aria-label="Return to the alert hit" onClick={() => goHit(here)} disabled={!here}>Return to alert</button>
          <button type="button" data-testid="skip-next-hit" className={BTN} aria-label="Next alert hit" onClick={() => stepHit(1)} disabled={!next}>Alert &#9654;</button>
        </span>
      )}
      {children}
    </div>
  );
}
