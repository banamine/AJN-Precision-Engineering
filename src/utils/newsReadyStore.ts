/**
 * Shared, polite poller for /api/news/version. It replaces the old auto-opening
 * "Latest news ready" overlay: state is exposed to the top-row "News" indicator
 * and the list only appears when the user opens the indicator's report.
 */
export type NewShow = {
  channelId: string;
  channelName: string;
  title: string;
  programId: string;
  description?: string;
  archivePath?: string;
  mediaUrl?: string;
  mediaType?: 'video' | 'audio';
  assetId?: string;
  sourceId?: string;
};

type VersionInfo = { version: number; fetchedAt: string | null; refreshing: boolean; newShows: NewShow[] };

export type NewsReadyPhase = 'checking' | 'current' | 'ready' | 'error';

export interface NewsReadySnapshot {
  phase: NewsReadyPhase;
  /** Server version of the content in `newShows` (or the last seen version). */
  version: number | null;
  newShows: NewShow[];
  fetchedAt: string | null;
  refreshing: boolean;
  /** Time of the last poll attempt that produced this snapshot. */
  checkedAt: number | null;
}

export interface NewsReadyPollerDeps {
  fetchImpl: typeof fetch;
  isVisible: () => boolean;
  onVisibilityChange: (listener: () => void) => () => void;
  setIntervalImpl?: typeof setInterval;
  clearIntervalImpl?: typeof clearInterval;
  intervalMs?: number;
  now?: () => number;
}

export interface NewsReadyPoller {
  getSnapshot(): NewsReadySnapshot;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<NewsReadySnapshot>;
  /** User has seen / played the current list: clear "News ready". */
  markSeen(): void;
}

export const NEWS_POLL_MS = 5 * 60_000;

const isNewShow = (value: unknown): value is NewShow => {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.programId === 'string' && typeof v.title === 'string' && typeof v.channelId === 'string';
};

function parseVersion(data: unknown): VersionInfo | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (typeof d.version !== 'number' || !Number.isFinite(d.version)) return null;
  return {
    version: d.version,
    fetchedAt: typeof d.fetchedAt === 'string' ? d.fetchedAt : null,
    refreshing: d.refreshing === true,
    newShows: Array.isArray(d.newShows) ? d.newShows.filter(isNewShow) : [],
  };
}

export function createNewsReadyPoller(deps: NewsReadyPollerDeps): NewsReadyPoller {
  const subscribers = new Set<() => void>();
  const setIntervalImpl = deps.setIntervalImpl ?? setInterval;
  const clearIntervalImpl = deps.clearIntervalImpl ?? clearInterval;
  const intervalMs = deps.intervalMs ?? NEWS_POLL_MS;
  const now = deps.now ?? Date.now;
  let snapshot: NewsReadySnapshot = { phase: 'checking', version: null, newShows: [], fetchedAt: null, refreshing: false, checkedAt: null };
  /** Version the user has already been shown (baseline = version at app open). */
  let seenVersion: number | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let removeVisibility: (() => void) | null = null;
  let inFlight: Promise<NewsReadySnapshot> | null = null;

  const publish = (next: NewsReadySnapshot) => {
    snapshot = next;
    for (const listener of subscribers) listener();
  };

  const refresh = (): Promise<NewsReadySnapshot> => {
    if (!deps.isVisible()) return Promise.resolve(snapshot);
    if (inFlight) return inFlight; // never stack duplicate polls
    inFlight = (async () => {
      const at = now();
      try {
        const res = await deps.fetchImpl('/api/news/version', { cache: 'no-store', headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`news version HTTP ${res.status}`);
        const info = parseVersion(await res.json());
        if (!info) throw new Error('news version payload invalid');
        if (seenVersion === null || info.version < seenVersion) {
          // First answer since app open — or the server restarted and its counter
          // went backwards. Either way this is the new baseline, not "new news".
          seenVersion = info.version;
        }
        if (info.version > seenVersion && info.newShows.length > 0) {
          publish({ phase: 'ready', version: info.version, newShows: info.newShows, fetchedAt: info.fetchedAt, refreshing: info.refreshing, checkedAt: at });
        } else if (snapshot.phase === 'ready' && snapshot.version !== null && snapshot.version > seenVersion) {
          // Still holding an unseen list; keep it (only the refresh flag/time change).
          publish({ ...snapshot, refreshing: info.refreshing, checkedAt: at });
        } else {
          publish({ phase: 'current', version: info.version, newShows: [], fetchedAt: info.fetchedAt, refreshing: info.refreshing, checkedAt: at });
        }
      } catch {
        // A failed check never discards an unseen list the user can still play.
        if (snapshot.phase === 'ready') publish({ ...snapshot, checkedAt: at });
        else publish({ ...snapshot, phase: 'error', refreshing: false, checkedAt: at });
      } finally {
        inFlight = null;
      }
      return snapshot;
    })();
    return inFlight;
  };

  const stop = () => {
    if (timer !== null) clearIntervalImpl(timer);
    timer = null;
  };
  const start = () => {
    if (!deps.isVisible() || timer !== null) return;
    void refresh();
    timer = setIntervalImpl(() => { if (deps.isVisible()) void refresh(); }, intervalMs);
  };
  const onVisibility = () => {
    if (deps.isVisible()) start();
    else stop();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      subscribers.add(listener);
      if (subscribers.size === 1) {
        removeVisibility = deps.onVisibilityChange(onVisibility);
        start();
      }
      return () => {
        subscribers.delete(listener);
        if (subscribers.size === 0) {
          stop();
          removeVisibility?.();
          removeVisibility = null;
        }
      };
    },
    refresh,
    markSeen() {
      if (snapshot.phase !== 'ready' || snapshot.version === null) return;
      seenVersion = snapshot.version;
      publish({ ...snapshot, phase: 'current', newShows: [] });
    },
  };
}

export const newsReadyStore = createNewsReadyPoller({
  fetchImpl: (input, init) => fetch(input, init),
  isVisible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
  onVisibilityChange: (listener) => {
    if (typeof document === 'undefined') return () => {};
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  },
});
