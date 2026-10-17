// Today's Digest data: the 5 AJN feeds (small, for the really-new items) plus a spread of pages from the WHOLE Library (video and audio) for the backfill.
// Every failure is counted and surfaced; nothing is invented. Feeds refresh every 30 min; the library spread is re-drawn at the viewer's local midnight.
import { useCallback, useEffect, useRef, useState } from 'react';
import { hash32, localDateKey, msUntilLocalMidnight } from '../utils/dayRotation';
import { DISCOVER_CATEGORIES, toDiscoverItem } from './useDiscoverPool';
import { AJN_DIGEST_FEEDS, cardFromFeedItem, cardFromLibrary, type DigestCard, type FeedItemWire } from '../home/digestModel';

const FEED_REFRESH_MS = 30 * 60 * 1000;
const PAGE_SIZE = 48;
const EXTRA_PAGES = 2; // page 1 tells us totalPages; two more are drawn from the session seed
type Wire = Parameters<typeof toDiscoverItem>[0];

const labelFor = (id: string | undefined): string => {
  if (!id) return 'Library';
  return DISCOVER_CATEGORIES.find((c) => c.id === id)?.label ?? id.replace(/[-_]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
};

export interface DigestPool {
  phase: 'idle' | 'loading' | 'ready' | 'error';
  fresh: DigestCard[]; library: DigestCard[];
  feedsFailed: number; librarySourcesFailed: number; error: string | null; retry: () => void;
}

export function useTodaysDigest(enabled: boolean, sessionPart: string): DigestPool {
  const [feedState, setFeedState] = useState<{ done: boolean; fresh: DigestCard[]; failed: number }>({ done: false, fresh: [], failed: 0 });
  const [libState, setLibState] = useState<{ done: boolean; library: DigestCard[]; failed: number; error: string | null }>({ done: false, library: [], failed: 0, error: null });
  const [attempt, setAttempt] = useState(0);
  const [day, setDay] = useState(() => localDateKey());
  const sessionRef = useRef(sessionPart); // read once: Shuffle changes the seed but must not refetch the library

  // flip the library spread at local midnight
  useEffect(() => {
    if (!enabled) return;
    const t = window.setTimeout(() => setDay(localDateKey()), msUntilLocalMidnight() + 500);
    return () => window.clearTimeout(t);
  }, [enabled, day]);

  // AJN feeds: the only source of the NEW label
  useEffect(() => {
    if (!enabled) return;
    const ctl = new AbortController();
    const load = async () => {
      const results = await Promise.allSettled(AJN_DIGEST_FEEDS.map(async (f) => {
        const r = await fetch(`/api/ajn/resources/${f.id}`, { signal: ctl.signal });
        if (!r.ok) throw new Error(`${f.id} HTTP ${r.status}`);
        const items = ((await r.json()) as { items?: FeedItemWire[] }).items ?? [];
        const now = Date.now();
        return items.map((it) => cardFromFeedItem(f, it, now)).filter((c): c is DigestCard => !!c);
      }));
      if (ctl.signal.aborted) return;
      const fresh = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
      const failed = results.filter((r) => r.status === 'rejected').length;
      // a failed refresh keeps the last good NEW cards; a first load that fails shows nothing and says so (failed > 0)
      setFeedState((prev) => (fresh.length > 0 || prev.fresh.length === 0 ? { done: true, fresh, failed } : { done: true, fresh: prev.fresh, failed }));
    };
    void load();
    const t = window.setInterval(() => void load(), FEED_REFRESH_MS);
    return () => { ctl.abort(); window.clearInterval(t); };
  }, [enabled, attempt]);

  // Library: pages drawn from the whole library, video and audio separately so both kinds are always in the pool
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const ctl = new AbortController();
    const page = async (mediaType: 'video' | 'audio', n: number) => {
      const r = await fetch(`/api/library/items?mediaType=${mediaType}&limit=${PAGE_SIZE}&page=${n}`, { signal: ctl.signal });
      if (!r.ok) throw new Error(`library ${mediaType} HTTP ${r.status}`);
      return (await r.json()) as { totalPages?: number; items?: Wire[] };
    };
    const toCards = (items: Wire[]): DigestCard[] => items.flatMap((w) => {
      const first = w.type === 'series' ? w.episodes?.[0] : w;
      const id = first && 'categoryIds' in first ? first.categoryIds?.[0] : undefined;
      const d = toDiscoverItem(w, { id: id ?? 'library', label: labelFor(id) });
      return d ? [cardFromLibrary(d)] : [];
    });
    (async () => {
      let failed = 0; let lastError: string | null = null; const all: DigestCard[] = [];
      await Promise.all((['video', 'audio'] as const).map(async (type) => {
        try {
          const first = await page(type, 1);
          all.push(...toCards(first.items ?? []));
          const total = Math.max(1, Number(first.totalPages) || 1);
          const wanted = new Set<number>();
          for (let i = 0; wanted.size < Math.min(EXTRA_PAGES, total - 1) && i < 20; i++) { const n = 2 + (hash32(`${sessionRef.current}|${day}|${type}|${i}`) % Math.max(1, total - 1)); if (n <= total) wanted.add(n); }
          for (const n of wanted) { try { all.push(...toCards((await page(type, n)).items ?? [])); } catch (e) { if ((e as Error)?.name === 'AbortError') return; failed++; lastError = e instanceof Error ? e.message : String(e); } }
        } catch (e) { if ((e as Error)?.name === 'AbortError') return; failed++; lastError = e instanceof Error ? e.message : String(e); }
      }));
      if (!alive) return;
      setLibState((prev) => (all.length > 0 || prev.library.length === 0 ? { done: true, library: all, failed, error: all.length ? null : lastError } : { done: true, library: prev.library, failed, error: null }));
    })();
    return () => { alive = false; ctl.abort(); };
  }, [enabled, attempt, day]);

  const retry = useCallback(() => { setFeedState({ done: false, fresh: [], failed: 0 }); setLibState({ done: false, library: [], failed: 0, error: null }); setAttempt((n) => n + 1); }, []);
  const done = feedState.done && libState.done;
  const empty = feedState.fresh.length + libState.library.length === 0;
  const phase: DigestPool['phase'] = !enabled ? 'idle' : !done && empty ? 'loading' : done && empty ? 'error' : 'ready';
  const error = phase === 'error' ? (libState.error ?? (feedState.failed ? `${feedState.failed} of ${AJN_DIGEST_FEEDS.length} feeds failed` : 'nothing returned')) : null;
  return { phase, fresh: feedState.fresh, library: libState.library, feedsFailed: feedState.failed, librarySourcesFailed: libState.failed, error, retry };
}
