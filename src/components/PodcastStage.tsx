import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { adLeftText, usePodcastCaptions, type CaptionView } from '../hooks/usePodcastCaptions';
import type { AdSkipSource } from '../hooks/usePodcastAdSkip';
import { fmtMS } from '../utils/podcastAdSkip';
import { syncLabel } from '../utils/captionSync';
import { NewsCarousel } from './NewsCarousel';

const BEFORE = 2; const AFTER = 2;       // lines drawn around the current one
const IDLE_MS = 6000;                     // how long reading/aligning keeps the carousel still and the auto-follow off

interface Props {
  getMedia: () => HTMLMediaElement | null;
  source: AdSkipSource | null;
  analyser: AnalyserNode | null;
  /** true when the signal meter can read this source (the show is CORS-verified and the analyser is running) */
  meter: boolean;
  /** show art: drawn when there are no captions to show, so the stage is never an empty box */
  artUrl?: string | null;
  title?: string;
}

const BADGE: Record<string, string> = {
  locked: 'border-emerald-300/40 bg-emerald-300/10 text-emerald-100',
  'in-sync': 'border-emerald-300/40 bg-emerald-300/10 text-emerald-100',
  manual: 'border-sky-300/40 bg-sky-300/10 text-sky-100',
  approx: 'border-amber-300/40 bg-amber-300/10 text-amber-100',
  unmapped: 'border-amber-300/40 bg-amber-300/10 text-amber-100',
};

/** Inside the audio stage on podcast episodes: live captions on the left, the Daily Digest news carousel on the right (wide windows). */
export function PodcastStage({ getMedia, source, analyser, meter, artUrl, title }: Props): ReactElement | null {
  const cap = usePodcastCaptions(getMedia, source, analyser, meter);
  const { view } = cap;
  const [hold, setHold] = useState(false);
  const holdTimer = useRef<number | null>(null);
  const [tapMode, setTapMode] = useState<'auto' | 'align' | 'jump'>('auto');
  const bump = () => { setHold(true); if (holdTimer.current) window.clearTimeout(holdTimer.current); holdTimer.current = window.setTimeout(() => setHold(false), IDLE_MS); };
  useEffect(() => () => { if (holdTimer.current) window.clearTimeout(holdTimer.current); }, []);
  if (!source) return null;
  const hasCaptions = view.state !== 'no-transcript' && view.state !== 'error';
  return (
    // Lives INSIDE the audio stage (there is no visualizer to show for podcasts): fills the stage under the top badges.
    <section data-testid="podcast-stage" aria-label="Captions and news" className="pointer-events-none absolute inset-x-0 bottom-0 top-11 z-[5] flex flex-col gap-2 px-2 pb-2 sm:px-3 sm:pb-3 md:flex-row md:gap-3">
      <div className="pointer-events-auto min-h-0 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/60 p-2 backdrop-blur-sm sm:p-3">
        {hasCaptions
          ? <Captions cap={cap} onInteract={bump} tapMode={tapMode} setTapMode={setTapMode} />
          : (
            <div className="flex h-full items-center gap-3">
              {artUrl && <img src={artUrl} alt="" aria-hidden="true" className="hidden aspect-square h-24 shrink-0 rounded-full object-cover ring-2 ring-sky-300/40 sm:block" />}
              <div className="min-w-0">
                {title && <p className="truncate text-sm font-semibold text-white">{title}</p>}
                <p data-testid="captions-none" className="text-xs text-neutral-300">{syncLabel(view.state, view.meter)}</p>
              </div>
            </div>
          )}
      </div>
      <div data-testid="stage-news" className="pointer-events-auto hidden min-h-0 shrink-0 overflow-y-auto rounded-xl border border-white/10 bg-black/60 p-3 backdrop-blur-sm md:block md:w-72">
        <NewsCarousel hold={hold} />
      </div>
    </section>
  );
}

function Captions({ cap, onInteract, tapMode, setTapMode }: { cap: ReturnType<typeof usePodcastCaptions>; onInteract: () => void; tapMode: 'auto' | 'align' | 'jump'; setTapMode: (m: 'auto' | 'align' | 'jump') => void }): ReactElement {
  const { view } = cap;
  const box = useRef<HTMLOListElement | null>(null);
  const curRef = useRef<HTMLLIElement | null>(null);
  const follow = useRef(true);
  const followTimer = useRef<number | null>(null);
  const reduced = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lo = Math.max(0, view.index - BEFORE); const hi = Math.min(view.cues.length, Math.max(view.index, 0) + AFTER + 1);
  const lines = useMemo(() => view.cues.slice(lo, hi), [view.cues, lo, hi]);
  const effective: 'align' | 'jump' = tapMode === 'auto' ? (view.state === 'locked' || view.state === 'in-sync' ? 'jump' : 'align') : tapMode;
  const loading = view.state === 'loading';

  const manualScroll = () => {
    follow.current = false; onInteract();
    if (followTimer.current) window.clearTimeout(followTimer.current);
    followTimer.current = window.setTimeout(() => { follow.current = true; }, IDLE_MS);
  };
  useEffect(() => () => { if (followTimer.current) window.clearTimeout(followTimer.current); }, []);

  const tap = (i: number) => { onInteract(); if (effective === 'jump') cap.jumpTo(i); else cap.alignTo(i); follow.current = true; };
  let lastSp = '';
  return (
    <div data-testid="captions" className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-200">Live captions</span>
        <span data-testid="captions-state" data-state={view.state} className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${BADGE[view.state] ?? 'border-white/15 text-neutral-300'}`}>{syncLabel(view.state, view.meter && view.autoSync)}</span>
        <span className="flex-1" />
        {view.meter && (
          <button type="button" data-testid="captions-autosync" aria-pressed={view.autoSync} onClick={() => cap.setAutoSync(!view.autoSync)}
            title="Matches the transcript's pauses to real silences in the audio (needs the signal meter)"
            className="rounded px-1.5 py-0.5 text-[10px] font-bold text-neutral-200 underline decoration-dotted underline-offset-2 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
            Auto-sync: {view.autoSync ? 'On' : 'Off'}
          </button>
        )}
        <button type="button" data-testid="captions-tapmode" onClick={() => setTapMode(effective === 'jump' ? 'align' : 'jump')}
          title={effective === 'jump' ? 'Tapping a line plays from it' : 'Tapping a line says: this is what I am hearing now'}
          className="rounded px-1.5 py-0.5 text-[10px] font-bold text-neutral-200 underline decoration-dotted underline-offset-2 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
          Tap: {effective === 'jump' ? 'Jump' : 'Align'}
        </button>
      </div>
      {view.sponsor && (
        <div data-testid="sponsor-chip" role="group" aria-label="Sponsor read" className="flex items-center gap-2 rounded-lg border border-amber-300/50 bg-amber-300/15 px-2 py-1 text-xs text-amber-100">
          <span className="font-semibold tabular-nums">{view.sponsor.inside ? 'Sponsor read now' : `Sponsor read in ${fmtMS(Math.max(0, view.sponsor.startsIn))}`} (est.)</span>
          <button type="button" data-testid="sponsor-accept" onClick={cap.acceptSponsor} disabled={!view.sponsor.inside && view.sponsor.startsIn > 15}
            className="inline-flex h-8 items-center rounded-md bg-amber-300 px-2.5 text-xs font-bold tabular-nums text-black hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
            Skip +{fmtMS(view.sponsor.skipSeconds)}
          </button>
          <button type="button" data-testid="sponsor-dismiss" onClick={cap.dismissSponsor} aria-label="Not a sponsor read" title="Not a sponsor read"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/20 text-sm font-bold text-neutral-100 hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">×</button>
        </div>
      )}
      {view.ad && (
        <p data-testid="captions-ad" className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs font-semibold text-neutral-200">
          Ad break · {adLeftText(view.ad.left)}{view.ad.estimated ? ' (estimate)' : ''}
        </p>
      )}
      {loading ? <p className="text-xs text-neutral-400">Loading transcript…</p> : (
        <ol ref={box} data-testid="captions-list" aria-live="off" onWheel={manualScroll} onTouchMove={manualScroll} onPointerDown={onInteract}
          className={`flex min-h-0 flex-1 flex-col justify-center gap-1 overflow-hidden rounded-lg border border-white/10 bg-black/40 p-2 leading-snug ${view.ad ? 'opacity-50' : ''}`}>
          {lines.map((c, k) => {
            const i = lo + k; const cur = i === view.index && !view.ad;
            const dist = Math.abs(i - view.index);
            const showSp = view.hasSpeakers && c.sp && c.sp !== lastSp; if (c.sp) lastSp = c.sp;
            return (
              <li key={i} ref={i === view.index ? curRef : undefined} className="min-h-0">
                <button type="button" onClick={() => tap(i)} data-testid={cur ? 'caption-current' : undefined} aria-current={cur ? 'true' : undefined}
                  className={`block w-full rounded-lg px-2 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${cur ? 'line-clamp-5 bg-emerald-400/25 py-2 text-xl font-bold leading-snug text-white ring-1 ring-emerald-300/60 md:text-2xl' : `line-clamp-2 text-sm ${dist === 1 ? 'text-neutral-300' : 'text-neutral-500'} hover:text-white`}`}>
                  {showSp && <span className="mr-1.5 text-[10px] font-bold uppercase tracking-wide text-emerald-200/90">{c.sp}</span>}
                  {c.t}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export type { CaptionView };
