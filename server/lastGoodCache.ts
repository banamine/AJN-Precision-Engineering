export interface LastGoodCacheMeta {
  stale: boolean;
  lastRefreshError?: string;
}

export interface LastGoodCache<T> {
  get(key: string): Promise<T>;
  meta(key: string): LastGoodCacheMeta;
}

interface CacheEntry<T> {
  good: T | null;
  goodAt: number;
  inFlight: Promise<T> | null;
  lastError?: string;
}

interface CreateLastGoodCacheOptions<T> {
  ttlMs: number;
  load: (key: string) => Promise<T>;
  isValid: (value: T) => boolean;
  label: string;
}

export function createLastGoodCache<T>({
  ttlMs,
  load,
  isValid,
  label,
}: CreateLastGoodCacheOptions<T>): LastGoodCache<T> {
  const entries = new Map<string, CacheEntry<T>>();

  const entryFor = (key: string): CacheEntry<T> => {
    let entry = entries.get(key);
    if (!entry) {
      entry = { good: null, goodAt: 0, inFlight: null };
      entries.set(key, entry);
    }
    return entry;
  };

  const errorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

  const logKeepingSnapshot = (key: string, entry: CacheEntry<T>, reason: string) => {
    console.warn(
      `[${label}] ${key} refresh rejected: ${reason}; keeping snapshot from ${new Date(entry.goodAt).toISOString()}`,
    );
  };

  const refresh = (key: string, entry: CacheEntry<T>): Promise<T> => {
    const pending = Promise.resolve()
      .then(() => load(key))
      .then((value) => {
        if (!isValid(value)) {
          entry.lastError = 'invalid value';
          if (entry.good !== null) {
            logKeepingSnapshot(key, entry, entry.lastError);
            return entry.good;
          }
          return value;
        }

        entry.good = value;
        entry.goodAt = Date.now();
        entry.lastError = undefined;
        return value;
      })
      .catch((error: unknown) => {
        entry.lastError = errorMessage(error);
        if (entry.good !== null) {
          logKeepingSnapshot(key, entry, entry.lastError);
          return entry.good;
        }
        throw error;
      })
      .finally(() => {
        if (entry.inFlight === pending) entry.inFlight = null;
      });

    entry.inFlight = pending;
    return pending;
  };

  return {
    get(key) {
      const entry = entryFor(key);
      if (entry.good !== null) {
        if (Date.now() - entry.goodAt < ttlMs) return Promise.resolve(entry.good);
        if (entry.inFlight === null) void refresh(key, entry).catch(() => {});
        return Promise.resolve(entry.good);
      }

      return entry.inFlight ?? refresh(key, entry);
    },
    meta(key) {
      const entry = entries.get(key);
      if (!entry) return { stale: true };
      return {
        stale: entry.good === null || Date.now() - entry.goodAt >= ttlMs,
        ...(entry.lastError === undefined
          ? {}
          : { lastRefreshError: entry.lastError }),
      };
    },
  };
}
