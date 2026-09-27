// Archive.org upstream fetch with bounded retry for transient storage-node errors.
//
// Archive.org serves each item from 2-3 storage nodes (ia*/dn*.archive.org).
// A single node can briefly return 5xx. Each retry starts again from
// archive.org/download so Archive can redirect to a healthy replica.
// Permanent statuses (403 restricted, 404, 410) are returned immediately.

export type FetchImpl = typeof fetch;

export const RETRYABLE_UPSTREAM_STATUSES = new Set([429, 500, 502, 503, 504]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const USER_AGENT = 'AJN-Media-Console/ArchiveProxy';

export function isAllowedArchiveHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'archive.org' || host.endsWith('.archive.org');
}

export function validateArchiveRedirect(target: URL): void {
  if (target.protocol !== 'https:') {
    throw new Error('Archive redirect rejected: HTTPS is required');
  }
  if (!isAllowedArchiveHost(target.hostname)) {
    throw new Error(`Archive redirect rejected: ${target.hostname}`);
  }
}

export interface ResolveResult {
  /** Final storage URL, or null when Archive did not return a usable response. */
  url: string | null;
  /** Last upstream HTTP status seen while resolving. */
  status: number;
}

/**
 * Follow Archive redirects manually (validating every hop) to the storage node.
 * The probe body is never read, so no media bytes are downloaded here.
 */
export async function resolveArchiveMediaRedirect(
  initialUrl: string,
  opts: { fetchImpl?: FetchImpl; signal?: AbortSignal; maxRedirects?: number } = {},
): Promise<ResolveResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxRedirects = opts.maxRedirects ?? 5;
  let currentUrl = new URL(initialUrl);
  validateArchiveRedirect(currentUrl);

  for (let redirectCount = 0; redirectCount < maxRedirects; redirectCount++) {
    const response = await fetchImpl(currentUrl, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
      signal: opts.signal,
    });
    await response.body?.cancel().catch(() => {});

    if (response.status >= 200 && response.status < 300) {
      return { url: currentUrl.toString(), status: response.status };
    }
    if (!REDIRECT_STATUSES.has(response.status)) return { url: null, status: response.status };

    const location = response.headers.get('location');
    if (!location) return { url: null, status: response.status };

    const nextUrl = new URL(location, currentUrl);
    validateArchiveRedirect(nextUrl);
    currentUrl = nextUrl;
  }

  throw new Error('Archive redirect chain exceeded limit');
}

export interface ArchiveFetchResult {
  /** Final media response (2xx, or the last non-retryable/exhausted failure). */
  response: Response | null;
  /** Upstream status of the final attempt (0 when no response was obtained). */
  status: number;
  /** Number of resolve+fetch attempts made. */
  attempts: number;
  /** Human-readable failure stage when response is not 2xx. */
  failure?: 'resolve' | 'media';
}

export interface ArchiveFetchOptions {
  headers: Record<string, string>;
  signal?: AbortSignal;
  fetchImpl?: FetchImpl;
  attempts?: number;
  baseDelayMs?: number;
  requestId?: string;
  log?: (message: string, detail: Record<string, unknown>) => void;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Resolve and fetch Archive media, retrying transient 5xx/429 up to `attempts` times
 * with exponential backoff (400ms, 800ms by default). Range headers are sent on every
 * attempt, so a successful retry still yields 206. Never retries after abort.
 */
const REDIRECT_TTL_MS = 10 * 60_000;
const redirectCache = new Map<string, { url: string; expires: number }>();

export async function fetchArchiveMediaWithRetry(
  upstreamUrl: string,
  opts: ArchiveFetchOptions,
): Promise<ArchiveFetchResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const attempts = Math.max(1, opts.attempts ?? 3);
  const baseDelayMs = opts.baseDelayMs ?? 400;
  const sleep = opts.sleep ?? defaultSleep;
  const log = opts.log ?? ((message, detail) => console.warn(message, JSON.stringify(detail)));

  let last: ArchiveFetchResult = { response: null, status: 0, attempts: 0 };

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (opts.signal?.aborted) break;

    // Every audio/video slice used to re-resolve Archive's redirect first (an extra
    // full round trip per 8 MiB slice, ~1 s). Reuse the resolved node URL for a
    // while; on any failure it is dropped and resolved fresh on the retry.
    const cached = opts.fetchImpl ? undefined : redirectCache.get(upstreamUrl);
    const resolved = cached && cached.expires > Date.now() && attempt === 1
      ? { url: cached.url, status: 200 }
      : await resolveArchiveMediaRedirect(upstreamUrl, { fetchImpl, signal: opts.signal });
    if (!opts.fetchImpl && resolved.url && !(cached && cached.expires > Date.now())) {
      if (redirectCache.size > 500) redirectCache.clear();
      redirectCache.set(upstreamUrl, { url: resolved.url, expires: Date.now() + REDIRECT_TTL_MS });
    }
    let response: Response | null = null;
    let status = resolved.status;
    let failure: ArchiveFetchResult['failure'];

    if (resolved.url) {
      response = await fetchImpl(resolved.url, {
        method: 'GET',
        redirect: 'manual',
        headers: opts.headers,
        signal: opts.signal,
      });
      status = response.status;
      if (status < 200 || status >= 300) failure = 'media';
    } else {
      failure = 'resolve';
    }

    last = { response, status, attempts: attempt, failure };
    if (!failure) return last;
    redirectCache.delete(upstreamUrl);

    const retryable = RETRYABLE_UPSTREAM_STATUSES.has(status);
    if (!retryable || attempt === attempts || opts.signal?.aborted) return last;

    await response?.body?.cancel().catch(() => {});
    const delayMs = baseDelayMs * 2 ** (attempt - 1);
    log('[archive-proxy] transient upstream error, retrying', {
      requestId: opts.requestId ?? null,
      upstreamStatus: status,
      stage: failure,
      attempt,
      maxAttempts: attempts,
      delayMs,
      url: upstreamUrl,
    });
    await sleep(delayMs);
  }

  return last;
}
