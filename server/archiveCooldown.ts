export const ARCHIVE_MAX_RETRY_AFTER_HOP_MS = 10_000;
export const ARCHIVE_MAX_RETRY_AFTER_TOTAL_MS = 20_000;

export interface ArchiveCooldownTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ArchiveCooldownStoreOptions {
  now?: () => number;
  timers?: ArchiveCooldownTimers;
}

const MAX_TIMER_DELAY_MS = 2_147_483_647;

interface CooldownEntry {
  until: number;
  timer: unknown;
  promise: Promise<void>;
  resolve: () => void;
}

const REAL_TIMERS: ArchiveCooldownTimers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function abortError(): Error {
  const error = new Error('The operation was aborted while waiting for the Archive cooldown');
  error.name = 'AbortError';
  return error;
}

export function parseRetryAfter(value: string | null | undefined, nowMs = Date.now()): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds)
      ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.ceil(seconds * 1000)))
      : null;
  }
  const dateMs = Date.parse(trimmed);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - nowMs) : null;
}

export function retryAfterSeconds(milliseconds: number): number {
  return Math.max(0, Math.ceil(Math.max(0, milliseconds) / 1000));
}

export class ArchiveRateLimitError extends Error {
  readonly retryAfterSeconds: number;
  readonly host: string;

  constructor(host: string, waitMs: number) {
    super(`Archive is rate-limiting ${host}; retry after ${retryAfterSeconds(waitMs)} seconds`);
    this.name = 'ArchiveRateLimitError';
    this.host = host;
    this.retryAfterSeconds = retryAfterSeconds(waitMs);
  }
}

export interface ArchiveRateLimitHttpResponse {
  status: 429 | 503;
  retryAfterHeader: string;
  body: {
    error: 'Archive is rate-limiting';
    retryAfterSeconds: number;
    attempts: number;
    proxyRequestId: string;
  };
}

export function buildArchiveRateLimitHttpResponse(
  rateLimit: { status: 429 | 503; retryAfterSeconds: number },
  attempts: number,
  proxyRequestId: string,
): ArchiveRateLimitHttpResponse {
  return {
    status: rateLimit.status,
    retryAfterHeader: String(rateLimit.retryAfterSeconds),
    body: {
      error: 'Archive is rate-limiting',
      retryAfterSeconds: rateLimit.retryAfterSeconds,
      attempts,
      proxyRequestId,
    },
  };
}

/** One timer and one shared wait promise per upstream host. */
export class ArchiveCooldownStore {
  private readonly entries = new Map<string, CooldownEntry>();
  private readonly now: () => number;
  private readonly timers: ArchiveCooldownTimers;

  constructor(options: ArchiveCooldownStoreOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.timers = options.timers ?? REAL_TIMERS;
  }

  remainingMs(host: string): number {
    const entry = this.entries.get(host.toLowerCase());
    if (!entry) return 0;
    return Math.max(0, entry.until - this.now());
  }

  extend(host: string, delayMs: number): number {
    const key = host.toLowerCase();
    if (!key || !Number.isFinite(delayMs) || delayMs <= 0) return 0;
    const until = this.now() + Math.ceil(delayMs);
    let entry = this.entries.get(key);
    if (!entry) {
      let resolve = () => {};
      const promise = new Promise<void>((done) => { resolve = done; });
      entry = { until, timer: undefined, promise, resolve };
      this.entries.set(key, entry);
    } else if (until <= entry.until) {
      return Math.max(0, entry.until - this.now());
    } else {
      entry.until = until;
      this.timers.clearTimeout(entry.timer);
    }
    const scheduledEntry = entry;
    const finishOrReschedule = () => {
      if (this.entries.get(key) !== scheduledEntry) return;
      const remaining = scheduledEntry.until - this.now();
      if (remaining > 0) {
        scheduledEntry.timer = this.timers.setTimeout(finishOrReschedule, Math.min(MAX_TIMER_DELAY_MS, remaining));
        return;
      }
      this.entries.delete(key);
      scheduledEntry.resolve();
    };
    entry.timer = this.timers.setTimeout(
      finishOrReschedule,
      Math.min(MAX_TIMER_DELAY_MS, Math.max(0, entry.until - this.now())),
    );
    return Math.max(0, entry.until - this.now());
  }

  wait(host: string, signal?: AbortSignal): Promise<void> {
    const key = host.toLowerCase();
    const entry = this.entries.get(key);
    if (!entry || this.remainingMs(key) === 0) {
      if (entry) {
        this.timers.clearTimeout(entry.timer);
        this.entries.delete(key);
        entry.resolve();
      }
      return Promise.resolve();
    }
    if (signal?.aborted) return Promise.reject(abortError());
    if (!signal) return entry.promise;
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        signal.removeEventListener('abort', onAbort);
        reject(abortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
      entry.promise.then(
        () => { signal.removeEventListener('abort', onAbort); resolve(); },
        (error: unknown) => { signal.removeEventListener('abort', onAbort); reject(error); },
      );
    });
  }

  get timerCount(): number {
    return this.entries.size;
  }

  clear(): void {
    for (const entry of this.entries.values()) {
      this.timers.clearTimeout(entry.timer);
      entry.resolve();
    }
    this.entries.clear();
  }
}

export const sharedArchiveCooldownStore = new ArchiveCooldownStore();

export async function waitForArchiveCooldown(
  host: string,
  signal: AbortSignal | undefined,
  store: ArchiveCooldownStore = sharedArchiveCooldownStore,
): Promise<number> {
  const remaining = store.remainingMs(host);
  if (remaining <= 0) return 0;
  if (remaining > ARCHIVE_MAX_RETRY_AFTER_HOP_MS) throw new ArchiveRateLimitError(host, remaining);
  await store.wait(host, signal);
  return remaining;
}
