import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Express, Request, Response as ExpressResponse } from 'express';

export const AFFILIATE_LISTING_URL = 'https://www.alexjoneslive.com/affiliates/mp4-segs/';
export const AFFILIATE_LISTING_MAX_BYTES = 2 * 1024 * 1024;
const FRESH_FOR_MS = 10 * 60 * 1000;
const MAX_STALE_FOR_MS = 36 * 60 * 60 * 1000;
const DEFAULT_CACHE_FILE = '/tmp/ajn-affiliate-listing-cache.json';

interface ListingCache {
  bodyBase64: string;
  fetchedAt: number;
}

interface AffiliateListingOptions {
  fetchImpl?: typeof fetch;
  cacheFile?: string;
  now?: () => number;
  timeoutMs?: number;
}

interface FetchSuccess {
  ok: true;
  cache: ListingCache;
}

interface FetchFailure {
  ok: false;
  detail: string;
}

type FetchResult = FetchSuccess | FetchFailure;

class ListingFailure extends Error {
  constructor(readonly detail: string) {
    super(detail);
    this.name = 'ListingFailure';
  }
}

function isCloudflareChallenge(text: string): boolean {
  return /just a moment|cf-chl|cf_chl|__cf_chl|challenge-platform/i.test(text);
}

function isValidListing(body: Buffer): boolean {
  const text = new TextDecoder('utf-8').decode(body);
  if (!/mp4-segs/i.test(text)) return false;
  return /<a\b[^>]*\bhref\s*=\s*(?:"[^"]*\.mp4(?:[?#][^"]*)?"|'[^']*\.mp4(?:[?#][^']*)?'|[^\s>]*\.mp4(?:[?#][^\s>]*)?)[^>]*>/i.test(text);
}

async function readBodyCapped(response: Response): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytes += value.byteLength;
      if (bytes > AFFILIATE_LISTING_MAX_BYTES) {
        await reader.cancel().catch(() => {});
        throw new ListingFailure('source_too_large');
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, bytes);
  } finally {
    reader.releaseLock();
  }
}

function parseCache(value: unknown, now: number): ListingCache | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.bodyBase64 !== 'string' || typeof candidate.fetchedAt !== 'number') return null;
  if (!Number.isSafeInteger(candidate.fetchedAt) || candidate.fetchedAt <= 0 || candidate.fetchedAt > now) return null;
  const body = Buffer.from(candidate.bodyBase64, 'base64');
  if (body.length > AFFILIATE_LISTING_MAX_BYTES || body.toString('base64') !== candidate.bodyBase64 || !isValidListing(body)) return null;
  return { bodyBase64: candidate.bodyBase64, fetchedAt: candidate.fetchedAt };
}

function listingBody(cache: ListingCache): Buffer {
  return Buffer.from(cache.bodyBase64, 'base64');
}

function sendListing(res: ExpressResponse, cache: ListingCache, source: 'live' | 'stale', now: number): void {
  res.status(200);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Listing-Fetched-At', new Date(cache.fetchedAt).toISOString());
  res.setHeader('X-Listing-Source', source);
  if (source === 'stale') {
    res.setHeader('X-Listing-Age-Seconds', String(Math.floor(Math.max(0, now - cache.fetchedAt) / 1000)));
  }
  res.end(listingBody(cache));
}

async function writeCache(cacheFile: string, cache: ListingCache): Promise<void> {
  const parent = path.dirname(cacheFile);
  const tempFile = `${cacheFile}.${process.pid}.${Date.now()}.tmp`;
  await fs.mkdir(parent, { recursive: true });
  try {
    await fs.writeFile(tempFile, JSON.stringify(cache), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(tempFile, cacheFile);
  } catch (error) {
    await fs.rm(tempFile, { force: true }).catch(() => {});
    throw error;
  }
}

async function readCache(cacheFile: string, now: number): Promise<ListingCache | null> {
  try {
    return parseCache(JSON.parse(await fs.readFile(cacheFile, 'utf8')) as unknown, now);
  } catch {
    return null;
  }
}

async function fetchListing(
  fetchImpl: typeof fetch,
  timeoutMs: number,
  now: () => number,
): Promise<FetchResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let didTimeout = false;
  const request = (async (): Promise<FetchResult> => {
    try {
      const response = await fetchImpl(AFFILIATE_LISTING_URL, {
        method: 'GET',
        redirect: 'error',
        headers: { accept: 'text/html' },
        signal: controller.signal,
      });
      const body = await readBodyCapped(response);
      const text = new TextDecoder('utf-8').decode(body);
      if (isCloudflareChallenge(text)) return { ok: false, detail: 'cloudflare_challenge' };
      if (response.status !== 200) return { ok: false, detail: `upstream_http_${response.status}` };
      if (!isValidListing(body)) return { ok: false, detail: 'invalid_listing' };
      return {
        ok: true,
        cache: { bodyBase64: body.toString('base64'), fetchedAt: now() },
      };
    } catch (error) {
      if (error instanceof ListingFailure) return { ok: false, detail: error.detail };
      if (didTimeout || controller.signal.aborted) return { ok: false, detail: 'timeout' };
      if (error instanceof Error && /redirect/i.test(error.message)) return { ok: false, detail: 'redirect_rejected' };
      return { ok: false, detail: 'network_error' };
    }
  })();

  const timeout = new Promise<FetchFailure>((resolve) => {
    timer = setTimeout(() => {
      didTimeout = true;
      controller.abort();
      resolve({ ok: false, detail: 'timeout' });
    }, timeoutMs);
  });
  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function registerAffiliateListingRoute(app: Express, options: AffiliateListingOptions = {}): void {
  const fetchImpl = options.fetchImpl ?? fetch;
  const cacheFile = options.cacheFile ?? DEFAULT_CACHE_FILE;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 20_000;
  let memoryCache: ListingCache | null = null;
  let cacheLoaded = false;
  let inFlight: Promise<FetchResult> | null = null;

  async function currentCache(): Promise<ListingCache | null> {
    if (!cacheLoaded) {
      memoryCache = await readCache(cacheFile, now());
      cacheLoaded = true;
    }
    return memoryCache;
  }

  app.get('/api/affiliate-listing', async (_req: Request, res: ExpressResponse) => {
    const timestamp = now();
    const lastGood = await currentCache();
    if (lastGood && timestamp - lastGood.fetchedAt <= FRESH_FOR_MS) {
      return sendListing(res, lastGood, 'live', timestamp);
    }

    if (!inFlight) {
      inFlight = fetchListing(fetchImpl, timeoutMs, now).finally(() => {
        inFlight = null;
      });
    }
    const result = await inFlight;
    if (result.ok === false) {
      const fallback = memoryCache ?? lastGood;
      if (fallback && now() - fallback.fetchedAt <= MAX_STALE_FOR_MS) {
        return sendListing(res, fallback, 'stale', now());
      }
      return res.status(502).json({ error: 'upstream_unavailable', detail: result.detail });
    }
    memoryCache = result.cache;
    cacheLoaded = true;
    // A live listing remains usable if the ephemeral cache volume is unavailable.
    await writeCache(cacheFile, result.cache).catch(() => {});
    return sendListing(res, result.cache, 'live', now());
  });
}
