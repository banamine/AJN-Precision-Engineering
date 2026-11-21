import { useMemo } from 'react';
import { useAjnFeeds } from './useAjnFeeds';
import { pickLatestFullShows, SHORTCUT_SHOWS, type FeedItemLike, type LatestFullShow } from '../utils/latestFullShows';

export type LatestFullShowsState = { status: 'loading' } | { status: 'ready'; shows: LatestFullShow[] } | { status: 'error'; message: string };

/** Reads the shared AJN feed store (no own fetch), picks the newest whole show of each. */
export function useLatestFullShows(): LatestFullShowsState {
  const feeds = useAjnFeeds();
  return useMemo<LatestFullShowsState>(() => {
    if (feeds.data) {
      const byFeed: Record<string, FeedItemLike[]> = {};
      for (const s of SHORTCUT_SHOWS) byFeed[s.feedId] = feeds.data.items.filter((i) => i.feedId === s.feedId);
      const shows = pickLatestFullShows(byFeed);
      if (shows.length > 0) return { status: 'ready', shows };
    }
    if (feeds.status === 'loading') return { status: 'loading' };
    return { status: 'error', message: feeds.error ?? 'AJN feeds are unavailable.' };
  }, [feeds.data, feeds.status, feeds.error]);
}
