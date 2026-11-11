import { useEffect, useState, type ReactElement } from 'react';
import { useDigest } from '../hooks/useDigest';
import { digestNotice, type DigestItem } from '../utils/newsDigest';

/** Daily Digest carousel for the Live Radio panel on stations with no song text. Links only: nothing here plays media.
 *  Auto-advances every 8 s, pauses on hover/focus/touch, and never auto-advances under reduced motion. */
export const CAROUSEL_MS = 8000;
export const CAROUSEL_MAX = 10;
export const stepIndex = (i: number, dir: 1 | -1, n: number): number => (n <= 0 ? 0 : (i + dir + n) % n);
const when = (iso: string | null): string => {
  if (!iso) return '';
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

interface ViewProps { items: readonly DigestItem[]; index: number; onStep: (dir: 1 | -1) => void; onPause: (p: boolean) => void; notice: string | null }
export function NewsCarouselView({ items, index, onStep, onPause, notice }: ViewProps): ReactElement {
  const it = items[index];
  return (
    <section data-testid="news-carousel" aria-roledescription="carousel" aria-label="Daily Digest headlines" className="flex h-full flex-col gap-2"
      onMouseEnter={() => onPause(true)} onMouseLeave={() => onPause(false)} onFocus={() => onPause(true)} onBlur={() => onPause(false)} onTouchStart={() => onPause(true)}>
      <div className="text-[10px] font-bold uppercase tracking-widest text-[#E06D3B]">Daily Digest · news</div>
      {!it ? <p data-testid="news-carousel-empty" className="text-xs text-slate-400">No digest stories available right now.</p> : (
        <a data-testid="news-carousel-item" href={it.url} target="_blank" rel="noopener noreferrer" className="flex min-h-[112px] gap-3 rounded-xl border border-white/10 bg-white/5 p-3 hover:border-[#E06D3B]">
          {it.imageUrl && <img src={it.imageUrl} alt="" loading="lazy" className="h-20 w-28 shrink-0 rounded-lg object-cover" />}
          <span className="min-w-0">
            <span className="block font-mono text-[10px] uppercase tracking-widest text-slate-400">{it.source}{when(it.publishedAt) ? ` · ${when(it.publishedAt)}` : ''}</span>
            <span className="block text-sm font-bold text-white">{it.title}</span>
          </span>
        </a>
      )}
      <div className="flex items-center gap-2">
        <button type="button" className="ck-key ck-key--sm" aria-label="Previous story" data-testid="news-carousel-prev" onClick={() => onStep(-1)}>‹ Prev</button>
        <span className="flex-1 text-center font-mono text-[10px] tabular-nums text-slate-400" data-testid="news-carousel-pos">{items.length ? `${index + 1} / ${items.length}` : '0 / 0'}</span>
        <button type="button" className="ck-key ck-key--sm" aria-label="Next story" data-testid="news-carousel-next" onClick={() => onStep(1)}>Next ›</button>
      </div>
      {notice && <p className="text-[10px] text-slate-500" data-testid="news-carousel-notice">{notice}</p>}
    </section>
  );
}

export function NewsCarousel(): ReactElement {
  const news = useDigest();
  const digest = news.data?.digest ?? null;
  const items = (digest?.top ?? []).slice(0, CAROUSEL_MAX);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => {
    if (paused || reduced || items.length < 2) return undefined;
    const t = window.setInterval(() => setIndex((i) => stepIndex(i, 1, items.length)), CAROUSEL_MS);
    return () => window.clearInterval(t);
  }, [paused, reduced, items.length]);
  const notice = digest ? digestNotice(digest.updatedAt, Date.now(), news.data?.status === 'error' ? news.data.error : null).text : news.phase === 'loading' ? 'Loading news…' : news.phase === 'error' ? `Digest unavailable (${news.error}).` : null;
  return <NewsCarouselView items={items} index={Math.min(index, Math.max(items.length - 1, 0))} onStep={(d) => setIndex((i) => stepIndex(i, d, items.length))} onPause={setPaused} notice={notice} />;
}
