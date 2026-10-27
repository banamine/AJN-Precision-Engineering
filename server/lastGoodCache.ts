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
  lastAttemptAt: number;
  lastFailure: LastFailure<T> | null;
}

type LastFailure<T> =
  | { kind: 'invalid'; value: T }
  | { kind: 'rejected'; error: unknown };

interface CreateLastGoodCacheOptions<T> {
  ttlMs: number;
  ttlFor?: (value: T) => number;
  failureBackoffMs?: number;
  load: (key: string) => Promise<T>;
  isValid: (value: T, key: string) => boolean;
  label: string;
}

export function createLastGoodCache<T>({
  ttlMs,
  ttlFor,
  failureBackoffMs = 15_000,
  load,
  isValid,
  label,
}: CreateLastGoodCacheOptions<T>): LastGoodCache<T> {
  const entries = new Map<string, CacheEntry<T>>();

  const entryFor = (key: string): CacheEntry<T> => {
    let entry = entries.get(key);
    if (!entry) {
      entry = { good: null, goodAt: 0, inFlight: null, lastAttemptAt: 0, lastFailure: null };
      entries.set(key, entry);
    }
    return entry;
  };

  const effectiveTtl = (value: T): number => ttlFor?.(value) ?? ttlMs;
  const isWithinFailureBackoff = (entry: CacheEntry<T>): boolean =>
    entry.lastFailure !== null && Date.now() - entry.lastAttemptAt < failureBackoffMs;

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
        if (!isValid(value, key)) {
          entry.lastError = 'invalid value';
          entry.lastAttemptAt = Date.now();
          entry.lastFailure = { kind: 'invalid', value };
          if (entry.good !== null) {
            logKeepingSnapshot(key, entry, entry.lastError);
            return entry.good;
          }
          return value;
        }

        entry.good = value;
        entry.goodAt = Date.now();
        entry.lastError = undefined;
        entry.lastAttemptAt = 0;
        entry.lastFailure = null;
        return value;
      })
      .catch((error: unknown) => {
        entry.lastError = errorMessage(error);
        entry.lastAttemptAt = Date.now();
        entry.lastFailure = { kind: 'rejected', error };
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
        if (Date.now() - entry.goodAt < effectiveTtl(entry.good)) return Promise.resolve(entry.good);
        if (entry.inFlight === null && !isWithinFailureBackoff(entry)) {
          void refresh(key, entry).catch(() => {});
        }
        return Promise.resolve(entry.good);
      }

      if (entry.inFlight !== null) return entry.inFlight;
      if (isWithinFailureBackoff(entry) && entry.lastFailure !== null) {
        return entry.lastFailure.kind === 'invalid'
          ? Promise.resolve(entry.lastFailure.value)
          : Promise.reject(entry.lastFailure.error);
      }
      return refresh(key, entry);
    },
    meta(key) {
      const entry = entries.get(key);
      if (!entry) return { stale: true };
      return {
        stale: entry.good === null || Date.now() - entry.goodAt >= effectiveTtl(entry.good),
        ...(entry.lastError === undefined
          ? {}
          : { lastRefreshError: entry.lastError }),
      };
    },
  };
}
