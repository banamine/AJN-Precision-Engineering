// Row 2 pool: a few items from several Library categories (server index: eligibility gate and FOX-clip exclusion already applied).
import { useCallback, useEffect, useState } from 'react';
import { hash32 } from '../utils/dayRotation';
import type { DiscoverItem } from '../home/hubModel';

export const DISCOVER_CATEGORIES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'documentaries', label: 'Documentaries' }, { id: 'old-time-radio', label: 'Old-Time Radio' }, { id: 'classic-cinema', label: 'Classic Cinema' },
  { id: 'cartoons', label: 'Cartoons' }, { id: 'audiobooks', label: 'Audiobooks' }, { id: 'newsreels', label: 'Newsreels & History' },
  { id: 'scifi-horror', label: 'Sci-Fi & Horror' }, { id: 'educational', label: 'Educational & Industrial' },
];
const PER_REQUEST = 12;
const PAGES_SPREAD = 3;

type WireItem = { type: 'item'; id: string; identifier: string; title: string; description?: string; categoryIds: string[]; mediaType: 'video' | 'audio'; year?: number; path: string; dur: number; channelId?: string; guideId?: string; programId?: string; sourceId?: string; assetId?: string };
type WireSeries = { type: 'series'; id: string; title: string; episodeCount: number; mediaType: 'video' | 'audio'; episodes: Array<WireItem & { episodeTitle?: string }> };

/** Archive item cover through our own proxy (same path rule as every other Archive request). */
export function archiveThumbFor(path: string): string | undefined {
  const m = path.match(/^\/download\/([^/]+)\//);
  return m ? `/api/archive/proxy?path=${encodeURIComponent(`/download/${m[1]}/__ia_thumb.jpg`)}` : undefined;
}

export function toDiscoverItem(w: WireItem | WireSeries, cat: { id: string; label: string }): DiscoverItem | null {
  const it: (WireItem & { episodeTitle?: string }) | undefined = w.type === 'series' ? w.episodes?.[0] : w;
  if (!it || !it.path) return null;
  const series = w.type === 'series';
  return {
    key: it.assetId || it.identifier || it.path, categoryId: cat.id, categoryLabel: cat.label,
    title: series ? w.title : it.title, subtitle: series ? `${(w as WireSeries).episodeCount} episodes` : (it.year ? String(it.year) : ''),
    mediaType: it.mediaType, path: it.path, thumb: archiveThumbFor(it.path), durSeconds: it.dur > 0 ? it.dur : undefined,
    channelId: it.channelId ?? `library-${cat.id}`, guideId: it.guideId ?? 'library', programId: it.programId ?? it.id, sourceId: it.sourceId, assetId: it.assetId,
  };
}

export interface DiscoverPool { phase: 'idle' | 'loading' | 'ready' | 'error'; items: DiscoverItem[]; failed: number; error: string | null; retry: () => void }

export function useDiscoverPool(enabled: boolean, seed: string): DiscoverPool {
  const [state, setState] = useState<{ phase: DiscoverPool['phase']; items: DiscoverItem[]; failed: number; error: string | null }>({ phase: 'idle', items: [], failed: 0, error: null });
  const [attempt, setAttempt] = useState(0);
  // The page per category comes from the session seed; Shuffle re-picks from this pool without another request.
  const sessionPage = (cat: string) => 1 + (hash32(`${seed.split(':')[0]}|${cat}`) % PAGES_SPREAD);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const controller = new AbortController();
    setState((s) => (s.items.length ? s : { phase: 'loading', items: [], failed: 0, error: null }));
    const get = async (cat: { id: string; label: string }, page: number): Promise<DiscoverItem[]> => {
      const res = await fetch(`/api/library/items?category=${encodeURIComponent(cat.id)}&limit=${PER_REQUEST}&page=${page}`, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { items?: Array<WireItem | WireSeries> };
      return (body.items ?? []).map((w) => toDiscoverItem(w, cat)).filter((x): x is DiscoverItem => !!x);
    };
    (async () => {
      const all: DiscoverItem[] = []; let failed = 0; let lastError: string | null = null;
      const queue = [...DISCOVER_CATEGORIES];
      const worker = async () => {
        for (let cat = queue.shift(); cat; cat = queue.shift()) {
          try {
            let got = await get(cat, sessionPage(cat.id));
            if (got.length === 0 && sessionPage(cat.id) !== 1) got = await get(cat, 1);
            all.push(...got);
          } catch (err) { if ((err as Error)?.name === 'AbortError') return; failed++; lastError = err instanceof Error ? err.message : String(err); }
        }
      };
      await Promise.all([worker(), worker()]);
      if (!alive) return;
      if (all.length === 0) setState({ phase: 'error', items: [], failed, error: lastError ?? 'no items returned' });
      else setState({ phase: 'ready', items: all, failed, error: null });
    })();
    return () => { alive = false; controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the page spread depends only on the session part of the seed, read once per attempt
  }, [enabled, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
