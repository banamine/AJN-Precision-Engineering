import { PROXY_SLICE_BYTES } from './proxyRange.js';
import {
  fetchArchiveMediaWithRetry,
  type ArchiveFetchOptions,
  type ArchiveFetchResult,
} from './archiveFetch.js';
import { sharedArchiveCooldownStore } from './archiveCooldown.js';

export const READAHEAD_TTL_MS = 60_000;
export const READAHEAD_PATH_FAILURE_TTL_MS = 30_000;
export const READAHEAD_MAX_IN_FLIGHT = 8;
export const READAHEAD_DEFAULT_MAX_MB = 0;
const MEDIA_EXTENSIONS = /\.(?:mp4|m4v|mov|webm|mkv|avi|mpg|mpeg|ogv|ogg|mp3|m4a|aac|wav|flac|oga|opus|wma)$/i;
const NON_MEDIA_EXTENSIONS = /\.(?:m3u8?|mpd|srt|vtt|ttml|ass|ssa|lrc|json|xml|txt|pls|xspf|ts)$/i;

export function isReadAheadMediaPath(path: string): boolean {
  const pathname = path.split(/[?#]/, 1)[0] ?? path;
  return !NON_MEDIA_EXTENSIONS.test(pathname) && MEDIA_EXTENSIONS.test(pathname);
}

export interface ReadAheadSlice {
  cleanPath: string;
  start: number;
  requestedEnd: number;
  rangeStart: number;
  rangeEnd: number;
  totalBytes: number;
  body: Buffer;
  contentType: string | null;
  etag: string | null;
  lastModified: string | null;
  acceptRanges: string;
  cacheControl: string;
  expiresAt: number;
}

export interface SliceReadAheadStats {
  readaheadHits: number;
  readaheadMisses: number;
  readaheadDiscarded: number;
  readaheadBytes: number;
  readaheadEvictions: number;
  readaheadCacheBytes: number;
}

export interface ReadAheadLookup {
  kind: 'hit' | 'miss' | 'off';
  entry?: ReadAheadSlice;
}

export interface PrefetchTask {
  done: Promise<void>;
  onParentResponseClosed(): void;
}

export interface SliceReadAheadOptions {
  maxTotalBytes: number;
  ttlMs?: number;
  pathFailureTtlMs?: number;
  maxGlobalInFlight?: number;
  now?: () => number;
  isPathAllowed: (cleanPath: string) => boolean;
  cooldownActive?: () => boolean;
  fetchMedia?: (
    url: string,
    options: ArchiveFetchOptions,
  ) => Promise<ArchiveFetchResult>;
}

function cacheKey(cleanPath: string, start: number, requestedEnd: number): string {
  return JSON.stringify([cleanPath, start, requestedEnd]);
}

function parseContentRange(value: string | null): { start: number; end: number; total: number } | null {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value ?? '');
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (![start, end, total].every(Number.isSafeInteger) || start < 0 || end < start || total <= end) return null;
  return { start, end, total };
}

export class SliceReadAheadCache {
  private readonly entries = new Map<string, ReadAheadSlice>();
  private storedBytes = 0;
  private evictions = 0;

  constructor(
    readonly maxTotalBytes: number,
    private readonly ttlMs = READAHEAD_TTL_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get currentBytes(): number {
    this.expire();
    return this.storedBytes;
  }

  get evictionCount(): number {
    return this.evictions;
  }

  peek(cleanPath: string, start: number, requestedEnd: number): ReadAheadSlice | null {
    this.expire();
    const key = cacheKey(cleanPath, start, requestedEnd);
    const entry = this.entries.get(key);
    if (!entry) return null;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  take(cleanPath: string, start: number, requestedEnd: number): ReadAheadSlice | null {
    const entry = this.peek(cleanPath, start, requestedEnd);
    if (!entry) return null;
    this.remove(cacheKey(cleanPath, start, requestedEnd));
    return entry;
  }

  store(entry: ReadAheadSlice): boolean {
    this.expire();
    if (this.maxTotalBytes <= 0 || entry.body.byteLength > this.maxTotalBytes) return false;
    const key = cacheKey(entry.cleanPath, entry.start, entry.requestedEnd);
    this.remove(key);
    while (this.storedBytes + entry.body.byteLength > this.maxTotalBytes) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) return false;
      this.remove(oldestKey);
      this.evictions++;
    }
    this.entries.set(key, entry);
    this.storedBytes += entry.body.byteLength;
    return true;
  }

  clear(): void {
    this.entries.clear();
    this.storedBytes = 0;
  }

  private expire(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.remove(key);
    }
  }

  private remove(key: string): void {
    const old = this.entries.get(key);
    if (!old) return;
    this.entries.delete(key);
    this.storedBytes = Math.max(0, this.storedBytes - old.body.byteLength);
  }
}

interface InFlightRead {
  controller: AbortController;
  expectedBytes: number;
  receivedBytes: number;
}

export class SliceReadAhead {
  readonly cache: SliceReadAheadCache;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly pathFailureTtlMs: number;
  private readonly maxGlobalInFlight: number;
  private readonly cooldownActive: () => boolean;
  private readonly fetchMedia: NonNullable<SliceReadAheadOptions['fetchMedia']>;
  private readonly inFlightByPath = new Map<string, InFlightRead>();
  private readonly failedPathUntil = new Map<string, number>();
  private readonly counters: SliceReadAheadStats = {
    readaheadHits: 0,
    readaheadMisses: 0,
    readaheadDiscarded: 0,
    readaheadBytes: 0,
    readaheadEvictions: 0,
    readaheadCacheBytes: 0,
  };

  constructor(private readonly options: SliceReadAheadOptions) {
    this.now = options.now ?? (() => Date.now());
    this.ttlMs = options.ttlMs ?? READAHEAD_TTL_MS;
    this.pathFailureTtlMs = options.pathFailureTtlMs ?? READAHEAD_PATH_FAILURE_TTL_MS;
    this.maxGlobalInFlight = options.maxGlobalInFlight ?? READAHEAD_MAX_IN_FLIGHT;
    this.cooldownActive = options.cooldownActive ?? (() => sharedArchiveCooldownStore.hasActiveCooldowns());
    this.fetchMedia = options.fetchMedia ?? fetchArchiveMediaWithRetry;
    this.cache = new SliceReadAheadCache(options.maxTotalBytes, this.ttlMs, this.now);
  }

  get enabled(): boolean {
    return this.options.maxTotalBytes > 0;
  }

  get inFlightCount(): number {
    return this.inFlightByPath.size;
  }

  get stats(): SliceReadAheadStats {
    return {
      ...this.counters,
      readaheadEvictions: this.cache.evictionCount,
      readaheadCacheBytes: this.cache.currentBytes,
    };
  }

  lookup(cleanPath: string, start: number, requestedEnd: number): ReadAheadLookup {
    if (!this.enabled) return { kind: 'off' };
    const entry = this.cache.take(cleanPath, start, requestedEnd);
    if (entry) {
      this.counters.readaheadHits++;
      return { kind: 'hit', entry };
    }
    this.counters.readaheadMisses++;
    return { kind: 'miss' };
  }

  prefetchNext(input: {
    cleanPath: string;
    currentStart: number;
    currentEnd: number;
    totalBytes: number;
    headers: Record<string, string>;
    responseIsOpen?: () => boolean;
  }): PrefetchTask | null {
    if (!this.enabled || !this.options.isPathAllowed(input.cleanPath)) return null;
    if (this.cooldownActive()) return null;
    if (!Number.isSafeInteger(input.currentStart) || !Number.isSafeInteger(input.currentEnd)
      || !Number.isSafeInteger(input.totalBytes) || input.currentStart < 0
      || input.totalBytes <= 0 || input.currentEnd < input.currentStart) return null;
    if (input.currentEnd - input.currentStart + 1 !== PROXY_SLICE_BYTES) return null;
    if (input.currentStart + PROXY_SLICE_BYTES >= input.totalBytes) return null;
    if (input.responseIsOpen && !input.responseIsOpen()) return null;

    const start = input.currentStart + PROXY_SLICE_BYTES;
    const requestedEnd = start + PROXY_SLICE_BYTES - 1;
    const rangeEnd = Math.min(requestedEnd, input.totalBytes - 1);
    const expectedBytes = rangeEnd - start + 1;
    if (expectedBytes <= 0 || expectedBytes > PROXY_SLICE_BYTES || expectedBytes > this.options.maxTotalBytes) return null;
    if (this.cache.peek(input.cleanPath, start, requestedEnd)) return null;
    if (this.inFlightByPath.has(input.cleanPath) || this.inFlightByPath.size >= this.maxGlobalInFlight) return null;
    const failureUntil = this.failedPathUntil.get(input.cleanPath) ?? 0;
    if (failureUntil > this.now()) return null;
    if (failureUntil) this.failedPathUntil.delete(input.cleanPath);

    const controller = new AbortController();
    const inFlight: InFlightRead = { controller, expectedBytes, receivedBytes: 0 };
    this.inFlightByPath.set(input.cleanPath, inFlight);
    const url = `https://archive.org${input.cleanPath}`;
    const headers = {
      ...input.headers,
      Range: `bytes=${start}-${requestedEnd}`,
      Accept: '*/*',
    };
    const done = this.fetchAndStore(input.cleanPath, url, start, requestedEnd, rangeEnd, input.totalBytes, expectedBytes, headers, inFlight);
    return {
      done,
      onParentResponseClosed: () => {
        if (inFlight.receivedBytes <= expectedBytes / 2 && !controller.signal.aborted) controller.abort();
      },
    };
  }

  private async fetchAndStore(
    cleanPath: string,
    url: string,
    start: number,
    requestedEnd: number,
    rangeEnd: number,
    totalBytes: number,
    expectedBytes: number,
    headers: Record<string, string>,
    inFlight: InFlightRead,
  ): Promise<void> {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let shouldBackoffPath = false;
    try {
      const result = await this.fetchMedia(url, {
        headers,
        signal: inFlight.controller.signal,
        requestId: 'archive-proxy-readahead',
      });
      const response = result.response;
      if (!response || result.failure || response.status !== 206) {
        await response?.body?.cancel().catch(() => {});
        shouldBackoffPath = !inFlight.controller.signal.aborted;
        this.counters.readaheadDiscarded++;
        return;
      }
      const contentRange = parseContentRange(response.headers.get('content-range'));
      const contentLength = Number(response.headers.get('content-length'));
      if (!contentRange || contentRange.start !== start || contentRange.end !== rangeEnd
        || contentRange.total !== totalBytes || !Number.isSafeInteger(contentLength)
        || contentLength !== expectedBytes || !response.body) {
        await response.body?.cancel().catch(() => {});
        shouldBackoffPath = true;
        this.counters.readaheadDiscarded++;
        return;
      }
      const body = Buffer.allocUnsafe(expectedBytes);
      reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.byteLength) continue;
        this.counters.readaheadBytes += value.byteLength;
        if (inFlight.receivedBytes + value.byteLength > expectedBytes || inFlight.controller.signal.aborted) {
          await reader.cancel().catch(() => {});
          shouldBackoffPath = !inFlight.controller.signal.aborted;
          this.counters.readaheadDiscarded++;
          return;
        }
        body.set(value, inFlight.receivedBytes);
        inFlight.receivedBytes += value.byteLength;
      }
      if (inFlight.receivedBytes !== expectedBytes || inFlight.controller.signal.aborted) {
        shouldBackoffPath = !inFlight.controller.signal.aborted;
        this.counters.readaheadDiscarded++;
        return;
      }
      const stored = this.cache.store({
        cleanPath,
        start,
        requestedEnd,
        rangeStart: contentRange.start,
        rangeEnd: contentRange.end,
        totalBytes,
        body,
        contentType: response.headers.get('content-type'),
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
        acceptRanges: response.headers.get('accept-ranges') ?? 'bytes',
        cacheControl: 'private, max-age=3600',
        expiresAt: this.now() + this.ttlMs,
      });
      if (!stored) {
        this.counters.readaheadDiscarded++;
        shouldBackoffPath = true;
      }
    } catch {
      shouldBackoffPath = !inFlight.controller.signal.aborted;
      this.counters.readaheadDiscarded++;
    } finally {
      if (reader) await reader.cancel().catch(() => {});
      if (shouldBackoffPath) this.failedPathUntil.set(cleanPath, this.now() + this.pathFailureTtlMs);
      if (this.inFlightByPath.get(cleanPath) === inFlight) this.inFlightByPath.delete(cleanPath);
    }
  }
}

export function readAheadMaxBytesFromEnv(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return READAHEAD_DEFAULT_MAX_MB * 1024 * 1024;
  const megabytes = Number(value);
  if (!Number.isFinite(megabytes) || megabytes < 0) return 0;
  return Math.floor(megabytes * 1024 * 1024);
}
