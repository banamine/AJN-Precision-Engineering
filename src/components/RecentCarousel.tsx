import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, Play } from 'lucide-react';
import type { HomeNowState } from '../hooks/useHomeNow';
import { useAjnFeeds } from '../hooks/useAjnFeeds';
import { ShowArt } from './ShowArt';
import { ajnCards, mixCards, nowCards, type CarouselCard } from '../utils/carouselItems';
import { localDateKey, msUntilLocalMidnight } from '../utils/dayRotation';
import type { Destination, MediaType, PlayProgramCallback } from '../types';

const ADVANCE_MS = 8000;

function usePerView(): number {
  const q = '(min-width: 1024px)';
  const [wide, setWide] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q).matches : true));
  const [mid, setMid] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(min-width: 640px)').matches : true));
  useEffect(() => {
    if (!window.matchMedia) return;
    const a = window.matchMedia(q), b = window.matchMedia('(min-width: 640px)');
    const on = () => { setWide(a.matches); setMid(b.matches); };
    a.addEventListener('change', on); b.addEventListener('change', on);
    return () => { a.removeEventListener('change', on); b.removeEventListener('change', on); };
  }, []);
  return wide ? 3 : mid ? 2 : 1;
}

function usePrefersReducedMotion(): boolean {
  const [r, setR] = useState(() => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (!window.matchMedia) return;
    const m = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setR(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return r;
}

function TypePill({ type }: { type?: MediaType }) {
  const audio = type === 'audio';
  return <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow ${audio ? 'bg-sky-600' : 'bg-orange-500'}`}>{audio ? 'Audio' : 'Video'}</span>;
}

const fmtTime = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''; };

interface Props { now: HomeNowState; onPlayProgram: PlayProgramCallback; onNavigate: (d: Destination) => void; playing: boolean }

export function RecentCarousel({ now, onPlayProgram, onNavigate, playing }: Props) {
  const feeds = useAjnFeeds();
  const perView = usePerView();
  const reduced = usePrefersReducedMotion();

  // The date key is part of the order, so the arrangement changes at the viewer's local midnight.
  const [dateKey, setDateKey] = useState(() => localDateKey());
  useEffect(() => {
    const t = window.setTimeout(() => setDateKey(localDateKey()), msUntilLocalMidnight() + 500);
    return () => window.clearTimeout(t);
  }, [dateKey]);

  const cards: CarouselCard[] = useMemo(
    () => mixCards(nowCards(now.items, dateKey, fmtTime), ajnCards(feeds.data?.items ?? [])),
    [now.items, feeds.data, dateKey],
  );

  const pages = Math.max(1, Math.ceil(cards.length / perView));
  const [page, setPage] = useState(0);
  const [hold, setHold] = useState(false);
  useEffect(() => { setPage((p) => Math.min(p, pages - 1)); }, [pages]);

  // Slow auto-advance. It stops on hover/focus, while something is playing, with reduced motion, and in a hidden tab.
  useEffect(() => {
    if (pages < 2 || hold || playing || reduced) return;
    const id = window.setInterval(() => { if (!document.hidden) setPage((p) => (p + 1) % pages); }, ADVANCE_MS);
    return () => window.clearInterval(id);
  }, [pages, hold, playing, reduced]);

  const go = (n: number) => setPage(((n % pages) + pages) % pages);
  const loading = now.status === 'loading' && feeds.status === 'loading';
  const firstVisible = page * perView, lastVisible = firstVisible + perView - 1;
  const play = (c: CarouselCard) => onPlayProgram(c.path, c.title, c.subtitle, c.mediaType, c.channelId, c.guideId, c.programId);

  return (
    <section aria-labelledby="recent-carousel-heading" className="space-y-4" data-testid="home-carousel">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 id="recent-carousel-heading" className="text-lg font-semibold tracking-tight text-neutral-100">On Air &amp; New Today</h2>
          <p className="mt-0.5 text-xs text-neutral-500">What is playing across the guides, plus the newest AJN shows.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onNavigate('tv-guide')} className="hidden items-center gap-1 text-xs font-medium text-sky-400 hover:text-sky-300 sm:flex">Full Guide <ArrowRight className="h-3.5 w-3.5" /></button>
          {pages > 1 && (
            <div className="flex items-center gap-1">
              <button type="button" aria-label="Previous" onClick={() => go(page - 1)} className="rounded-lg border border-neutral-800 bg-neutral-900 p-1.5 text-neutral-300 hover:bg-neutral-800"><ChevronLeft className="h-4 w-4" /></button>
              <button type="button" aria-label="Next" onClick={() => go(page + 1)} className="rounded-lg border border-neutral-800 bg-neutral-900 p-1.5 text-neutral-300 hover:bg-neutral-800"><ChevronRight className="h-4 w-4" /></button>
            </div>
          )}
        </div>
      </div>

      {loading && <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6 text-sm text-neutral-500">Loading what is on…</div>}
      {!loading && cards.length === 0 && (
        <div className="rounded-xl border border-dashed border-neutral-800 p-6 text-sm text-neutral-500">
          Nothing is airing in the guides right now{feeds.status === 'error' ? ' and the AJN feeds are unavailable' : ''}. Open the Full Guide to browse.
        </div>
      )}

      {cards.length > 0 && (
        <div
          className="overflow-hidden"
          role="group" aria-roledescription="carousel" aria-label="On air and new today"
          onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)}
          onFocus={() => setHold(true)} onBlur={() => setHold(false)}
          onKeyDown={(e) => { if (e.key === 'ArrowRight') go(page + 1); if (e.key === 'ArrowLeft') go(page - 1); }}
        >
          <ul className="flex transition-transform duration-700 ease-out motion-reduce:transition-none" style={{ transform: `translateX(-${page * 100}%)` }}>
            {cards.map((c, i) => {
              const visible = i >= firstVisible && i <= lastVisible;
              const near = i >= firstVisible - perView && i <= lastVisible + perView; // current page and its neighbours only
              return (
                <li key={c.id} aria-roledescription="slide" aria-label={`${i + 1} of ${cards.length}`} className="min-w-0 p-1.5" style={{ flex: `0 0 ${100 / perView}%`, maxWidth: `${100 / perView}%` }} inert={!visible}>
                  <button type="button" onClick={() => play(c)} aria-label={`Play ${c.title}`} className="group block w-full overflow-hidden rounded-xl border border-white/10 bg-neutral-900 text-left transition hover:border-sky-400/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
                    <div className="relative">
                      <ShowArt label={c.artLabel} mediaType={c.mediaType} src={c.thumb} load={near} className="aspect-video w-full" />
                      <div className="absolute left-2 top-2 z-[3] flex items-center gap-1.5"><TypePill type={c.mediaType} />{c.kind === 'now' && <span className="rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">On now</span>}</div>
                      <span className="absolute bottom-2 right-2 z-[3] flex h-8 w-8 items-center justify-center rounded-full bg-sky-500/90 text-white opacity-0 shadow transition group-hover:opacity-100 group-focus-visible:opacity-100"><Play className="ml-0.5 h-4 w-4 fill-current" /></span>
                    </div>
                    <div className="space-y-0.5 p-3">
                      <h3 className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-snug text-neutral-100">{c.title}</h3>
                      <p className="truncate text-[11px] text-neutral-400">{c.source}</p>
                      <p className="h-4 truncate text-[11px] text-neutral-500">{c.meta}</p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-center gap-1.5" role="tablist" aria-label="Carousel pages">
          {Array.from({ length: pages }, (_, i) => (
            <button key={i} type="button" role="tab" aria-selected={i === page} aria-label={`Page ${i + 1}`} onClick={() => go(i)} className={`h-1.5 rounded-full transition-all ${i === page ? 'w-6 bg-sky-400' : 'w-1.5 bg-neutral-700 hover:bg-neutral-500'}`} />
          ))}
        </div>
      )}
      {now.pending.length > 0 && <p className="text-center text-[11px] text-neutral-600">Still loading {now.pending.length} more genre{now.pending.length === 1 ? '' : 's'}…</p>}
    </section>
  );
}
