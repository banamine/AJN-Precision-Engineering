import { useCallback, useEffect, useRef, useState } from 'react';
import { toCubeArticles, type CubeAdapterResult, type CubeDropCounts } from './adapter';

export const NEWS_CUBE_CONFIG = {
  // Optional build-time override. `env` is absent outside Vite (tsx tests), so read it defensively.
  digestUrl: (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_NEWS_DIGEST_URL
    || 'https://banamine.github.io/Daily-News-Digest-/data/current/data.json',
  refreshMs: 10 * 60 * 1000,
  staleHours: 36,
} as const;
const browserFetch: typeof fetch = (input, init) => fetch(input, init);

export interface NewsCubeSnapshot extends CubeAdapterResult {
  lastUpdated: string | null;
  storiesCount: number | null;
  rssArticlesCount: number | null;
}

export interface NewsCubeDataOptions {
  fetcher?: typeof fetch;
  digestUrl?: string;
  refreshMs?: number;
  now?: () => number;
}

export interface NewsCubeDataState {
  snapshot: NewsCubeSnapshot | null;
  loading: boolean;
  error: string | null;
  hasNewStories: boolean;
  refresh: () => Promise<void>;
  applyNewStories: () => void;
  setInteracting: (interacting: boolean) => void;
}

function countOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function snapshotSignature(snapshot: NewsCubeSnapshot | null): string {
  if (!snapshot) return '';
  return snapshot.articles.map((article) => `${article.id}\u0000${article.publishedAt}\u0000${article.title}`).join('\u0001');
}

export function isDigestStale(lastUpdated: string | null, nowMs: number): boolean {
  const parsed = Date.parse(lastUpdated ?? '');
  return !Number.isFinite(parsed) || nowMs - parsed > NEWS_CUBE_CONFIG.staleHours * 60 * 60 * 1000;
}

function toSnapshot(raw: unknown, now: number): NewsCubeSnapshot {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Digest response is not an object.');
  const data = raw as Record<string, unknown>;
  const adapted = toCubeArticles(data, now);
  return {
    ...adapted,
    lastUpdated: typeof data.last_updated === 'string' ? data.last_updated : null,
    storiesCount: countOrNull(data.stories_count),
    rssArticlesCount: countOrNull(data.rss_articles_count),
  };
}

const emptyDrops = (): CubeDropCounts => ({ noDate: 0, tooOld: 0, fake: 0, duplicate: 0, invalid: 0 });

export function useNewsCubeData(options: NewsCubeDataOptions = {}): NewsCubeDataState {
  const fetcher = options.fetcher ?? browserFetch;
  const digestUrl = options.digestUrl ?? NEWS_CUBE_CONFIG.digestUrl;
  const refreshMs = options.refreshMs ?? NEWS_CUBE_CONFIG.refreshMs;
  const now = options.now ?? Date.now;
  const [snapshot, setSnapshot] = useState<NewsCubeSnapshot | null>(null);
  const [pendingSnapshot, setPendingSnapshot] = useState<NewsCubeSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasNewStories, setHasNewStories] = useState(false);
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  const interactingRef = useRef(false);
  const requestRef = useRef(0);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const refresh = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading((current) => current && !snapshotRef.current);
    try {
      const response = await fetcher(digestUrl, { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`Digest HTTP ${response.status}`);
      const next = toSnapshot(await response.json(), now());
      if (requestId !== requestRef.current) return;
      setError(null);
      setLoading(false);
      if (interactingRef.current && snapshotSignature(snapshotRef.current) !== snapshotSignature(next)) {
        setPendingSnapshot(next);
        setHasNewStories(true);
      } else {
        setSnapshot(next);
        setPendingSnapshot(null);
        setHasNewStories(false);
      }
    } catch (cause) {
      if (requestId !== requestRef.current) return;
      setLoading(false);
      setError(cause instanceof Error ? cause.message : 'Digest could not be loaded.');
    }
  }, [digestUrl, fetcher, now]);

  useEffect(() => {
    void refresh();
    return () => { requestRef.current += 1; };
  }, [refresh]);

  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (!visible || refreshMs <= 0) return;
    const timer = window.setInterval(() => { void refresh(); }, refreshMs);
    return () => window.clearInterval(timer);
  }, [refresh, refreshMs, visible]);

  const setInteracting = useCallback((interacting: boolean) => {
    interactingRef.current = interacting;
  }, []);
  const applyNewStories = useCallback(() => {
    if (!pendingSnapshot) return;
    setSnapshot(pendingSnapshot);
    setPendingSnapshot(null);
    setHasNewStories(false);
  }, [pendingSnapshot]);

  return {
    snapshot: snapshot ?? (loading ? null : {
      articles: [], dropped: emptyDrops(), lastUpdated: null, storiesCount: null, rssArticlesCount: null,
    }),
    loading,
    error,
    hasNewStories,
    refresh,
    applyNewStories,
    setInteracting,
  };
}
