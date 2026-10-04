// Daily News Digest source: fetched from GitHub Pages into memory (no database), last-good kept, failures never cached as success.
// Only the digest URL's own host is ever contacted (every redirect hop is checked by safeFetch).
import { safeFetch, readTextCapped, SafeFetchError } from './safeFetch';
import { parseNewsDigest, type Digest } from '../src/utils/newsDigest';

export const DIGEST_URL_DEFAULT = 'https://banamine.github.io/Daily-News-Digest-/data/current/data.json';
export const DIGEST_TTL_MS = 15 * 60_000;
export const DIGEST_FAILURE_RETRY_MS = 60_000;
export const DIGEST_TIMEOUT_MS = 15_000;
export const DIGEST_MAX_BYTES = 5 * 1024 * 1024;

export interface DigestState {
  digest: Digest | null;
  /** When the digest was last fetched successfully. */
  fetchedAt: string | null;
  /** 'ok' = last attempt succeeded; 'error' = last attempt failed (a digest, if present, is the last good one); 'pending' = never attempted. */
  status: 'ok' | 'error' | 'pending';
  error: string | null;
}

export interface DigestStoreOptions { url?: string; fetchImpl?: typeof fetch; now?: () => number; ttlMs?: number; failureRetryMs?: number; timeoutMs?: number }

const describe = (e: unknown): string => e instanceof SafeFetchError ? `${e.reason}: ${e.message}` : e instanceof Error ? e.message : String(e);

export function createDigestStore(opts: DigestStoreOptions = {}) {
  const now = opts.now ?? Date.now;
  const ttl = opts.ttlMs ?? DIGEST_TTL_MS;
  const failureRetry = opts.failureRetryMs ?? DIGEST_FAILURE_RETRY_MS;
  let state: DigestState = { digest: null, fetchedAt: null, status: 'pending', error: null };
  let lastAttempt = 0;
  let inflight: Promise<DigestState> | null = null;

  const resolveUrl = (): URL => {
    const raw = opts.url ?? process.env.NEWS_DIGEST_URL ?? DIGEST_URL_DEFAULT;
    let url: URL;
    try { url = new URL(raw); } catch { throw new Error('NEWS_DIGEST_URL is not a valid URL'); }
    if (url.protocol !== 'https:') throw new Error('NEWS_DIGEST_URL must be https');
    return url;
  };

  async function refresh(): Promise<DigestState> {
    lastAttempt = now();
    try {
      const url = resolveUrl();
      const { res } = await safeFetch(url, { allow: host => host === url.hostname, timeoutMs: opts.timeoutMs ?? DIGEST_TIMEOUT_MS, fetchImpl: opts.fetchImpl, headers: { 'user-agent': 'ajn-precision-engineering/digest', accept: 'application/json' } });
      if (!res.ok) { await res.body?.cancel().catch(() => {}); throw new Error(`HTTP ${res.status}`); }
      const digest = parseNewsDigest(JSON.parse(await readTextCapped(res, DIGEST_MAX_BYTES))); // throws on an empty digest: that is a failure, not a success
      state = { digest, fetchedAt: new Date(now()).toISOString(), status: 'ok', error: null };
    } catch (e) {
      state = { ...state, status: 'error', error: describe(e) }; // keep the last good digest, if any
    }
    return state;
  }

  async function get(force = false): Promise<DigestState> {
    const age = now() - lastAttempt;
    const fresh = state.status === 'ok' ? age < ttl : state.status === 'error' ? age < failureRetry : false;
    if (!force && fresh) return state;
    inflight ??= refresh().finally(() => { inflight = null; });
    return inflight;
  }
  return { get };
}

const store = createDigestStore();
export const getDigestState = (): Promise<DigestState> => store.get();
