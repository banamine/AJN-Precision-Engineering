import { useEffect, useState } from 'react';
import { pickLatestFullShows, SHORTCUT_SHOWS, type FeedItemLike, type LatestFullShow } from '../utils/latestFullShows';

const REFRESH_MS = 30 * 60 * 1000; // new day's links appear without a page reload

export type LatestFullShowsState = { status: 'loading' } | { status: 'ready'; shows: LatestFullShow[] } | { status: 'error'; message: string };

/** Loads only the two whole-show feeds (small), picks the newest of each, refreshes every 30 minutes. */
export function useLatestFullShows(): LatestFullShowsState {
  const [state, setState] = useState<LatestFullShowsState>({ status: 'loading' });
  useEffect(() => {
    const ctl = new AbortController();
    const load = async () => {
      try {
        const results = await Promise.allSettled(SHORTCUT_SHOWS.map(async (s) => {
          const r = await fetch(`/api/ajn/resources/${s.feedId}`, { signal: ctl.signal });
          if (!r.ok) throw new Error(`${s.feedId} HTTP ${r.status}`);
          return [s.feedId, ((await r.json()).items ?? []) as FeedItemLike[]] as const;
        }));
        if (ctl.signal.aborted) return;
        const byFeed: Record<string, FeedItemLike[]> = {};
        for (const r of results) if (r.status === 'fulfilled') byFeed[r.value[0]] = [...r.value[1]];
        const shows = pickLatestFullShows(byFeed);
        // Keep the last good buttons if a refresh fails; only report an error when we have nothing to show.
        setState((prev) => shows.length > 0 ? { status: 'ready', shows } : prev.status === 'ready' ? prev : { status: 'error', message: 'AJN feeds are unavailable.' });
      } catch (e) {
        if (!ctl.signal.aborted) setState((prev) => prev.status === 'ready' ? prev : { status: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    };
    void load();
    const t = window.setInterval(() => void load(), REFRESH_MS);
    return () => { ctl.abort(); window.clearInterval(t); };
  }, []);
  return state;
}
