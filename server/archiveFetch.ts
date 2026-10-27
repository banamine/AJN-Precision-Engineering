// Archive.org upstream fetch with bounded retry for transient storage-node errors.
//
// Archive.org serves each item from 2-3 storage nodes (ia*/dn*.archive.org).
// A single node can briefly return 5xx. Each retry starts again from
// archive.org/download so Archive can redirect to a healthy replica.
// Permanent statuses (403 restricted, 404, 410) are returned immediately.

import {
  ARCHIVE_MAX_RETRY_AFTER_HOP_MS,
  ARCHIVE_MAX_RETRY_AFTER_TOTAL_MS,
  ArchiveCooldownStore,
  parseRetryAfter,
  retryAfterSeconds,
  sharedArchiveCooldownStore,
} from './archiveCooldown';
import {
  archiveApiFetchWithContext,
  type ArchivePhysicalRequestContext,
} from './archiveLimiter';

export type FetchImpl = typeof fetch;

export const RETRYABLE_UPSTREAM_STATUSES = new Set([429, 500, 502, 503, 504]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const USER_AGENT = 'AJN-Media-Console/ArchiveProxy';

export class ArchiveRedirectRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveRedirectRejectedError';
  }
}

export class ArchiveCircuitOpenError extends Error {
  readonly code = 'AJN_UPSTREAM_CIRCUIT_OPEN';
  constructor(readonly host: string) {
    super(`Archive upstream circuit is open for ${host}`);
    this.name = 'ArchiveCircuitOpenError';
  }
}

export class ArchiveHostCircuitBreaker {
  private readonly states = new Map<string, { failures: number; openUntil: number }>();

  constructor(
    readonly threshold = 3,
    readonly cooldownMs = 20_000,
  ) {}

  canRequest(host: string, now = Date.now()): boolean {
    const key = host.toLowerCase();
    const state = this.states.get(key);
    if (!state) return true;
    if (state.openUntil > now) return false;
    if (state.openUntil > 0) this.states.delete(key);
    return true;
  }

  recordTimeout(host: string, now = Date.now()): { failures: number; opened: boolean } {
    const key = host.toLowerCase();
    const prior = this.states.get(key);
    const failures = (prior?.failures ?? 0) + 1;
    const opened = failures >= this.threshold;
    this.states.set(key, { failures, openUntil: opened ? now + this.cooldownMs : 0 });
    return { failures, opened };
  }

  /** Milliseconds until an open circuit for this host allows requests again (0 when closed). */
  remainingMs(host: string, now = Date.now()): number {
    const state = this.states.get(host.toLowerCase());
    return state && state.openUntil > now ? state.openUntil - now : 0;
  }

  recordSuccess(host: string): void {
    this.states.delete(host.toLowerCase());
  }

  reset(): void {
    this.states.clear();
  }
}

export const archiveHostCircuitBreaker = new ArchiveHostCircuitBreaker();

export function isAllowedArchiveHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'archive.org' || host.endsWith('.archive.org');
}

export function validateArchiveRedirect(target: URL): void {
  if (target.protocol !== 'https:') {
    throw new ArchiveRedirectRejectedError('Archive redirect rejected: HTTPS is required');
  }
  if (!isAllowedArchiveHost(target.hostname)) {
    throw new ArchiveRedirectRejectedError(`Archive redirect rejected: ${target.hostname}`);
  }
}

// Bound connection + response-header wait; once headers arrive the media body is streamed
// without a timer. This is deliberately shorter than Undici's observed ~20 s connect wait.
export const NODE_HEADER_TIMEOUT_MS = 8_000;
export const METADATA_TIMEOUT_MS = 10_000;
const MAX_ALTERNATE_NODES = 2;

function errorCode(error: unknown): string | undefined {
  const e = error as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  return typeof code === 'string' ? code : undefined;
}

function timedFetch(
  fetchImpl: FetchImpl,
  url: string | URL,
  init: RequestInit,
  parent: AbortSignal | undefined,
  ms: number,
  physicalContext?: ArchivePhysicalRequestContext,
): Promise<Response> {
  const host = new URL(url).hostname.toLowerCase();
  if (!archiveHostCircuitBreaker.canRequest(host)) {
    return Promise.reject(new ArchiveCircuitOpenError(host));
  }
  const controller = new AbortController();
  const parentAbort = () => controller.abort();
  if (parent?.aborted) controller.abort();
  else parent?.addEventListener('abort', parentAbort, { once: true });
  let timedOut = false;
  let headersReceived = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);
  const requestInit = { ...init, signal: controller.signal };
  const request = physicalContext
    ? archiveApiFetchWithContext(url, requestInit, physicalContext, fetchImpl)
    : fetchImpl(url, requestInit);
  return request
    .then((response) => {
      headersReceived = true;
      archiveHostCircuitBreaker.recordSuccess(host);
      return response;
    })
    .catch((error) => {
      const undiciConnectTimeout = errorCode(error) === 'UND_ERR_CONNECT_TIMEOUT';
      if (undiciConnectTimeout || timedOut) {
        const state = archiveHostCircuitBreaker.recordTimeout(host);
        if (state.opened) {
          console.warn('[archive-proxy] upstream host circuit opened', JSON.stringify({
            host, consecutiveTimeouts: state.failures, cooldownMs: archiveHostCircuitBreaker.cooldownMs,
          }));
        }
        if (undiciConnectTimeout) throw error;
      }
      if (!timedOut) {
        throw error;
      }
      const timeout = new Error(`Archive response headers timed out after ${ms} ms`) as Error & {
        code: string; archiveHost: string; cause?: unknown;
      };
      timeout.name = 'TimeoutError';
      timeout.code = 'AJN_UPSTREAM_HEADER_TIMEOUT';
      timeout.archiveHost = host;
      timeout.cause = error;
      throw timeout;
    })
    .finally(() => {
      clearTimeout(timer);
      // Keep the parent disconnect wired to the fetch signal after headers so a
      // downstream close still cancels the streamed response body.
      if (!headersReceived) parent?.removeEventListener('abort', parentAbort);
    });
}

export function archiveIdentifierAndRest(upstreamUrl: string): { id: string; rest: string } | null {
  try {
    const url = new URL(upstreamUrl);
    const match = url.pathname.match(/^\/download\/([^/]+)\/(.+)$/);
    return match ? { id: match[1], rest: match[2] } : null;
  } catch {
    return null;
  }
}

const metadataCache = new Map<string, { dir: string; hosts: string[]; expires: number }>();

/** Other storage nodes that hold the item, from Archive's metadata (never includes `skipHost`). */
export async function lookupAlternateNodes(
  id: string,
  skipHost: string | null,
  opts: { fetchImpl?: FetchImpl; signal?: AbortSignal; timeoutMs?: number; physicalContext?: ArchivePhysicalRequestContext } = {},
): Promise<{ dir: string; hosts: string[] } | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const cached = opts.fetchImpl ? undefined : metadataCache.get(id);
  let entry = cached && cached.expires > Date.now() ? cached : null;
  if (!entry) {
    try {
      const response = await timedFetch(
        fetchImpl,
        `https://archive.org/metadata/${encodeURIComponent(id)}`,
        { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } },
        opts.signal,
        opts.timeoutMs ?? METADATA_TIMEOUT_MS,
        opts.physicalContext,
      );
      if (!response.ok) return null;
      const meta = await response.json() as { dir?: unknown; server?: unknown; d1?: unknown; d2?: unknown; workable_servers?: unknown };
      const dir = typeof meta.dir === 'string' ? meta.dir : '';
      if (!dir.startsWith('/') || dir.includes('..')) return null;
      const hosts = [...new Set([
        meta.server, meta.d1, meta.d2,
        ...(Array.isArray(meta.workable_servers) ? meta.workable_servers : []),
      ].filter((host): host is string => typeof host === 'string' && isAllowedArchiveHost(host)))];
      entry = { dir, hosts, expires: Date.now() + REDIRECT_TTL_MS };
      if (!opts.fetchImpl) {
        if (metadataCache.size > 500) metadataCache.clear();
        metadataCache.set(id, entry);
      }
    } catch {
      return null;
    }
  }
  const hosts = entry.hosts.filter((host) => host.toLowerCase() !== (skipHost ?? '').toLowerCase());
  return hosts.length ? { dir: entry.dir, hosts } : null;
}

export interface ResolveResult {
  /** Final storage URL, or null when Archive did not return a usable response. */
  url: string | null;
  /** Last upstream HTTP status seen while resolving. */
  status: number;
  /** Retry-After from a non-redirect response, if present. */
  retryAfter?: string | null;
  /** Host that returned the non-redirect response. */
  host?: string;
}

/**
 * Follow Archive redirects manually (validating every hop) to the storage node.
 * The probe body is never read, so no media bytes are downloaded here.
 */
export async function resolveArchiveMediaRedirect(
  initialUrl: string,
  opts: { fetchImpl?: FetchImpl; signal?: AbortSignal; maxRedirects?: number; timeoutMs?: number; physicalContext?: ArchivePhysicalRequestContext } = {},
): Promise<ResolveResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxRedirects = opts.maxRedirects ?? 5;
  let currentUrl = new URL(initialUrl);
  validateArchiveRedirect(currentUrl);

  for (let redirectCount = 0; redirectCount < maxRedirects; redirectCount++) {
    let response: Response;
    try {
      response = await timedFetch(
        fetchImpl,
        currentUrl,
        // Probe with a 1-byte range: a bare GET made Archive start sending (or, for TV
        // clips, cut) the whole file just to read the redirect headers, which stalled
        // past the header timeout under load and surfaced as 502s.
        { method: 'GET', redirect: 'manual', headers: { 'User-Agent': USER_AGENT, Accept: '*/*', Range: 'bytes=0-0' } },
        opts.signal,
        opts.timeoutMs ?? NODE_HEADER_TIMEOUT_MS,
        opts.physicalContext,
      );
    } catch (error) {
      (error as { archiveHost?: string }).archiveHost = currentUrl.hostname;
      throw error;
    }
    await response.body?.cancel().catch(() => {});

    if (response.status >= 200 && response.status < 300) {
      return { url: currentUrl.toString(), status: response.status };
    }
    if (!REDIRECT_STATUSES.has(response.status)) {
      return {
        url: null,
        status: response.status,
        retryAfter: response.headers.get('retry-after'),
        host: currentUrl.hostname,
      };
    }

    const location = response.headers.get('location');
    if (!location) return { url: null, status: response.status };

    let nextUrl: URL;
    try {
      nextUrl = new URL(location, currentUrl);
    } catch {
      throw new ArchiveRedirectRejectedError('Archive redirect rejected: invalid Location URL');
    }
    validateArchiveRedirect(nextUrl);
    currentUrl = nextUrl;
  }

  throw new ArchiveRedirectRejectedError('Archive redirect rejected: redirect chain exceeded limit');
}

type ResolveFlight = {
  controller: AbortController;
  promise: Promise<ResolveResult>;
  waiters: number;
  settled: boolean;
};
let resolveFlightsByFetch = new WeakMap<FetchImpl, Map<string, ResolveFlight>>();

function waitForCaller<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    const error = new Error('Archive fetch aborted');
    error.name = 'AbortError';
    return Promise.reject(error);
  }
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => {
      cleanup();
      const error = new Error('Archive fetch aborted');
      error.name = 'AbortError';
      reject(error);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => { cleanup(); resolve(value); },
      (error) => { cleanup(); reject(error); },
    );
  });
}

/** Coalesce only the bounded 1-byte redirect probe; each client receives its own streamed media response. */
async function resolveArchiveMediaRedirectSingleFlight(
  initialUrl: string,
  opts: { fetchImpl?: FetchImpl; signal?: AbortSignal; maxRedirects?: number; timeoutMs?: number; physicalContext?: ArchivePhysicalRequestContext } = {},
): Promise<ResolveResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  if (opts.physicalContext) {
    return resolveArchiveMediaRedirect(initialUrl, { ...opts, fetchImpl });
  }
  let flights = resolveFlightsByFetch.get(fetchImpl);
  if (!flights) {
    flights = new Map();
    resolveFlightsByFetch.set(fetchImpl, flights);
  }
  const key = `${initialUrl}\n${opts.maxRedirects ?? 5}\n${opts.timeoutMs ?? NODE_HEADER_TIMEOUT_MS}`;
  let flight = flights.get(key);
  if (!flight) {
    const controller = new AbortController();
    const created: ResolveFlight = {
      controller,
      promise: Promise.resolve(null as unknown as ResolveResult),
      waiters: 0,
      settled: false,
    };
    created.promise = resolveArchiveMediaRedirect(initialUrl, {
      ...opts,
      fetchImpl,
      signal: controller.signal,
    }).finally(() => {
      created.settled = true;
      if (flights?.get(key) === created) flights.delete(key);
    });
    flight = created;
    flights.set(key, flight);
    // Observe errors if every caller aborts before the shared probe settles.
    void flight.promise.catch(() => {});
  }
  flight.waiters += 1;
  try {
    return await waitForCaller(flight.promise, opts.signal);
  } finally {
    flight.waiters -= 1;
    if (flight.waiters === 0 && !flight.settled) flight.controller.abort();
  }
}

export interface ArchiveFetchResult {
  /** Final media response (2xx, or the last non-retryable/exhausted failure). */
  response: Response | null;
  /** Upstream status of the final attempt (0 when no response was obtained). */
  status: number;
  /** Number of resolve+fetch attempts made. */
  attempts: number;
  /** Human-readable failure stage when response is not 2xx. */
  failure?: 'resolve' | 'media' | 'rate-limit';
  /** Non-retryable URL-policy rejection returned to the proxy for an explicit error. */
  reason?: string;
  /** Stable upstream error code for telemetry and truthful HTTP status mapping. */
  errorCode?: string;
  /** Kept in memory for classifying site health; never returned as user-visible raw upstream text. */
  errorMessage?: string;
  /** Rate limit exceeded the retry wait budget or there were no attempts left. */
  rateLimit?: { status: 429 | 503; retryAfterSeconds: number };
  /** Circuit open: how long until this storage host may be asked again. */
  retryAfterMs?: number;
}

export interface ArchiveFetchOptions {
  headers: Record<string, string>;
  signal?: AbortSignal;
  fetchImpl?: FetchImpl;
  attempts?: number;
  baseDelayMs?: number;
  requestId?: string;
  /** Max wait for response headers per upstream request (default 8 s). */
  headerTimeoutMs?: number;
  log?: (message: string, detail: Record<string, unknown>) => void;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Injectable only for deterministic tests; production uses one shared host store. */
  cooldownStore?: ArchiveCooldownStore;
  now?: () => number;
  physicalContext?: ArchivePhysicalRequestContext;
}

const defaultSleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) {
    const error = new Error('The operation was aborted during retry backoff');
    error.name = 'AbortError';
    reject(error);
    return;
  }
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort);
    resolve();
  }, ms);
  const onAbort = () => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    const error = new Error('The operation was aborted during retry backoff');
    error.name = 'AbortError';
    reject(error);
  };
  signal?.addEventListener('abort', onAbort, { once: true });
});

async function fetchFromAlternateNode(
  upstreamUrl: string,
  failedHost: string | null,
  opts: ArchiveFetchOptions,
  fetchImpl: FetchImpl,
  log: (message: string, detail: Record<string, unknown>) => void,
  physicalContext?: ArchivePhysicalRequestContext,
): Promise<{ response: Response; url: string } | null> {
  const parts = archiveIdentifierAndRest(upstreamUrl);
  if (!parts) return null;
  const nodes = await lookupAlternateNodes(parts.id, failedHost, {
    fetchImpl,
    signal: opts.signal,
    timeoutMs: opts.headerTimeoutMs,
    physicalContext: physicalContext ? { ...physicalContext, stage: 'alternate-metadata' } : undefined,
  });
  if (!nodes) return null;

  for (const host of nodes.hosts.slice(0, MAX_ALTERNATE_NODES)) {
    if (opts.signal?.aborted) return null;
    const url = `https://${host}${nodes.dir}/${parts.rest}`;
    try {
      validateArchiveRedirect(new URL(url));
      const response = await timedFetch(
        fetchImpl,
        url,
        { method: 'GET', redirect: 'manual', headers: opts.headers },
        opts.signal,
        opts.headerTimeoutMs ?? NODE_HEADER_TIMEOUT_MS,
        physicalContext ? { ...physicalContext, stage: 'alternate' } : undefined,
      );
      if (response.status >= 200 && response.status < 300) {
        log('[archive-proxy] primary node unreachable, served from alternate node', {
          requestId: opts.requestId ?? null,
          failedHost,
          alternateHost: host,
          url: upstreamUrl,
        });
        return { response, url };
      }
      await response.body?.cancel().catch(() => {});
    } catch {
      // Try the next replica.
    }
  }
  return null;
}

/**
 * Resolve and fetch Archive media, retrying transient 5xx/429 up to `attempts` times
 * with exponential backoff (400ms, 800ms by default). Range headers are sent on every
 * attempt, so a successful retry still yields 206. Never retries after abort.
 */
const REDIRECT_TTL_MS = 10 * 60_000;
const redirectCache = new Map<string, { url: string; expires: number }>();

/** Drop a cached storage-node URL (used when a body stalls so the next request re-resolves). */
export function forgetArchiveRedirect(upstreamUrl: string): void {
  redirectCache.delete(upstreamUrl);
}

export async function fetchArchiveMediaWithRetry(
  upstreamUrl: string,
  opts: ArchiveFetchOptions,
): Promise<ArchiveFetchResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const auditPacing = process.env.AJN_NKER150_AUDIT_LEDGER === '1'
    || typeof opts.physicalContext?.onPhysicalRequest === 'function';
  const attempts = Math.max(1, opts.attempts ?? 3);
  const baseDelayMs = opts.baseDelayMs ?? 400;
  const sleep = opts.sleep ?? defaultSleep;
  const cooldowns = opts.cooldownStore ?? sharedArchiveCooldownStore;
  const now = opts.now ?? (() => Date.now());
  const log = opts.log ?? ((message, detail) => console.log(message, JSON.stringify(detail)));

  let last: ArchiveFetchResult = { response: null, status: 0, attempts: 0 };
  let retryWaitTotalMs = 0;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (opts.signal?.aborted) break;
    const physicalContext = (stage: string): ArchivePhysicalRequestContext | undefined => auditPacing ? ({
      ...opts.physicalContext,
      requestId: opts.requestId ?? opts.physicalContext?.requestId,
      attempt,
      maxAttempts: attempts,
      stage,
    }) : undefined;

    // Every audio/video slice used to re-resolve Archive's redirect first (an extra
    // full round trip per 8 MiB slice, ~1 s). Reuse the resolved node URL for a
    // while; on any failure it is dropped and resolved fresh on the retry.
    const cached = opts.fetchImpl ? undefined : redirectCache.get(upstreamUrl);
    let response: Response | null = null;
    let status = 0;
    let failure: ArchiveFetchResult['failure'];
    let failedHost: string | null = null;
    let networkError: unknown = null;
    let retryAfterHeader: string | null = null;

    try {
      const resolved = cached && cached.expires > Date.now() && attempt === 1
        ? { url: cached.url, status: 200 }
        : await resolveArchiveMediaRedirectSingleFlight(upstreamUrl, {
          fetchImpl, signal: opts.signal, timeoutMs: opts.headerTimeoutMs ?? NODE_HEADER_TIMEOUT_MS,
          physicalContext: physicalContext('resolve'),
        });
      if (!opts.fetchImpl && resolved.url && !(cached && cached.expires > Date.now())) {
        if (redirectCache.size > 500) redirectCache.clear();
        redirectCache.set(upstreamUrl, { url: resolved.url, expires: Date.now() + REDIRECT_TTL_MS });
      }
      status = resolved.status;

      if (resolved.url) {
        failedHost = new URL(resolved.url).hostname;
        response = await timedFetch(
          fetchImpl,
          resolved.url,
          { method: 'GET', redirect: 'manual', headers: opts.headers },
          opts.signal,
          opts.headerTimeoutMs ?? NODE_HEADER_TIMEOUT_MS,
          physicalContext('media'),
        );
        status = response.status;
        if (status < 200 || status >= 300) {
          failure = 'media';
          retryAfterHeader = response.headers.get('retry-after');
        }
      } else {
        failure = 'resolve';
        retryAfterHeader = resolved.retryAfter ?? null;
        failedHost = resolved.host ?? 'archive.org';
      }
    } catch (error) {
      // Client disconnect: let the caller handle the abort as before.
      if (opts.signal?.aborted) throw error;
      if (error instanceof ArchiveRedirectRejectedError) {
        return {
          response: null,
          status: 502,
          attempts: attempt,
          failure: 'resolve',
          reason: error.message,
        };
      }
      networkError = error;
      failedHost = error instanceof ArchiveCircuitOpenError
        ? error.host
        : (error as { archiveHost?: string }).archiveHost ?? failedHost;
      failure = 'resolve';
      status = 0;
    }

    if (networkError) {
      redirectCache.delete(upstreamUrl);
      const upstreamCode = errorCode(networkError);
      const primaryArchiveTimedOut = failedHost?.toLowerCase() === 'archive.org'
        && (upstreamCode === 'UND_ERR_CONNECT_TIMEOUT'
          || upstreamCode === 'AJN_UPSTREAM_HEADER_TIMEOUT'
          || upstreamCode === 'AJN_UPSTREAM_CIRCUIT_OPEN');
      // Querying metadata for an alternate replica repeats the same failing dependency
      // when archive.org itself cannot establish the initial connection.
      const alternate = primaryArchiveTimedOut
        ? null
        : await fetchFromAlternateNode(upstreamUrl, failedHost, opts, fetchImpl, log, physicalContext('alternate'));
      if (alternate) {
        if (!opts.fetchImpl) redirectCache.set(upstreamUrl, { url: alternate.url, expires: Date.now() + REDIRECT_TTL_MS });
        return { response: alternate.response, status: alternate.response.status, attempts: attempt };
      }
      const message = networkError instanceof Error ? networkError.message : String(networkError);
      last = {
        response: null,
        status: 0,
        attempts: attempt,
        failure: 'resolve',
        errorCode: upstreamCode,
        errorMessage: message,
      };
      // A circuit-open result means this host must not be retried during cooldown.
      // We already tried an alternate replica when the failed host was not archive.org.
      if (upstreamCode === 'AJN_UPSTREAM_CIRCUIT_OPEN') {
        const openHost = (networkError as { host?: string }).host ?? failedHost ?? 'archive.org';
        const retryAfterMs = archiveHostCircuitBreaker.remainingMs(openHost) || archiveHostCircuitBreaker.cooldownMs;
        return { ...last, attempts: Math.max(0, attempt - 1), retryAfterMs };
      }
      if (attempt < attempts && !opts.signal?.aborted) {
        const delayMs = baseDelayMs * 2 ** (attempt - 1);
        log('[archive-proxy] transient upstream retry', {
          requestId: opts.requestId ?? null,
          upstreamStatus: 0,
          stage: 'resolve',
          attempt,
          maxAttempts: attempts,
          delayMs,
          errorCode: upstreamCode ?? null,
          url: upstreamUrl,
        });
        await sleep(delayMs);
        continue;
      }
      const cause = (networkError as { cause?: { code?: string; message?: string } }).cause;
      console.warn('[archive-proxy] upstream network error', JSON.stringify({
        requestId: opts.requestId ?? null,
        url: upstreamUrl,
        host: (networkError as { archiveHost?: string }).archiveHost ?? failedHost,
        error: networkError instanceof Error ? networkError.message : String(networkError),
        cause: upstreamCode ?? cause?.message ?? null,
      }));
      return last;
    }

    last = { response, status, attempts: attempt, failure };
    if (!failure) return last;
    redirectCache.delete(upstreamUrl);

    const retryable = RETRYABLE_UPSTREAM_STATUSES.has(status);
    if (!retryable || opts.signal?.aborted) return last;

    await response?.body?.cancel().catch(() => {});
    const requestedWaitMs = parseRetryAfter(retryAfterHeader, now());
    if (requestedWaitMs !== null) {
      const cooldownHost = failedHost ?? 'archive.org';
      cooldowns.extend(cooldownHost, requestedWaitMs);
      const sharedWaitMs = cooldowns.remainingMs(cooldownHost);
      if (sharedWaitMs > ARCHIVE_MAX_RETRY_AFTER_HOP_MS
        || retryWaitTotalMs + sharedWaitMs > ARCHIVE_MAX_RETRY_AFTER_TOTAL_MS
        || attempt === attempts) {
        return {
          response: null,
          status,
          attempts: attempt,
          failure: 'rate-limit',
          rateLimit: { status: status === 429 ? 429 : 503, retryAfterSeconds: retryAfterSeconds(sharedWaitMs) },
        };
      }
      retryWaitTotalMs += sharedWaitMs;
      log('[archive-proxy] upstream Retry-After cooldown', {
        requestId: opts.requestId ?? null,
        upstreamStatus: status,
        host: cooldownHost,
        delayMs: sharedWaitMs,
        attempt,
        maxAttempts: attempts,
      });
      await cooldowns.wait(cooldownHost, opts.signal);
      if (opts.signal?.aborted) {
        const error = new Error('The operation was aborted during Archive Retry-After wait');
        error.name = 'AbortError';
        throw error;
      }
      continue;
    }

    if (attempt === attempts) return last;
    const delayMs = baseDelayMs * 2 ** (attempt - 1);
    log('[archive-proxy] transient upstream retry', {
      requestId: opts.requestId ?? null,
      upstreamStatus: status,
      stage: failure,
      attempt,
      maxAttempts: attempts,
      delayMs,
      url: upstreamUrl,
    });
    await sleep(delayMs, opts.signal);
  }

  return last;
}

/** Test-only reset for module-scoped retry, redirect, and circuit state. */
export function resetArchiveFetchStateForTests(): void {
  archiveHostCircuitBreaker.reset();
  resolveFlightsByFetch = new WeakMap();
  redirectCache.clear();
  metadataCache.clear();
}
