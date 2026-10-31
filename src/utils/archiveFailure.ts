/* Reads the proxy's JSON error for a failed Archive file and says what kind of failure it is.
 * The proxy already retried 3 times before it answered (attempts), so when Archive itself is overloaded
 * (HTTP 500/502/504 from its storage node, or no answer at all after those attempts) more automatic retries
 * only add load and make the person wait minutes. Say so plainly instead. */
export interface ProxyErrorBody {
  error?: string;
  reason?: string;
  upstreamStatus?: number;
  attempts?: number;
  proxyRequestId?: string;
  errorCode?: string;
  /** Client-only status from the diagnostic response; not emitted in the JSON body. */
  proxyHttpStatus?: number;
  /** Circuit open only: seconds until the app server will ask that Archive storage server again. */
  retryAfterSeconds?: number;
}
export type ArchiveFailure = 'definite' | 'overloaded' | 'transient' | 'slow';

export function classifyArchiveFailure(httpStatus: number, body: ProxyErrorBody): ArchiveFailure {
  const up = body.upstreamStatus ?? 0;
  if (
    body.errorCode === 'AJN_UPSTREAM_HEADER_TIMEOUT'
    || body.errorCode === 'UND_ERR_CONNECT_TIMEOUT'
    || body.errorCode === 'AJN_PROXY_HEADER_BUDGET_EXHAUSTED'
    || body.errorCode === 'AJN_UPSTREAM_CIRCUIT_OPEN'
  ) return 'slow';
  if (body.reason === 'UNPLAYABLE_ARCHIVE_MEMBER' || [403, 404, 410].includes(up) || httpStatus === 400 || httpStatus === 422) return 'definite';
  if ([500, 502, 504].includes(up) || httpStatus === 504) return 'overloaded';
  // The proxy already retried 3 times and got no answer at all: retrying again in place only adds load.
  if (up === 0 && httpStatus >= 500 && (body.attempts ?? 0) >= 3) return 'overloaded';
  return 'transient';
}

/** Return a same-origin, metadata-only lookup URL; never repeat the failed media request. */
export function archiveFailureDiagnosticUrl(source: string): string | null {
  try {
    const url = new URL(source, 'https://ajn.invalid');
    if (url.pathname !== '/api/archive/proxy' || !url.searchParams.has('path')) return null;
    url.searchParams.set('diagnostic', '1');
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

/** Default pause the server applies to a storage host after 3 timeouts (server/archiveFetch.ts ArchiveHostCircuitBreaker). */
export const ARCHIVE_CIRCUIT_COOLDOWN_MS = 20_000;

/** How long a Retry must wait before it can succeed (0 = retry now). */
export function archiveRetryWaitMs(body: ProxyErrorBody | null | undefined): number {
  if (!body || body.errorCode !== 'AJN_UPSTREAM_CIRCUIT_OPEN') return 0;
  const s = Number(body.retryAfterSeconds);
  return Number.isFinite(s) && s > 0 ? Math.min(s, 120) * 1000 : ARCHIVE_CIRCUIT_COOLDOWN_MS;
}

export function overloadedMessage(body: ProxyErrorBody): string {
  if (body.errorCode === 'AJN_UPSTREAM_CIRCUIT_OPEN') {
    const secs = Math.ceil(archiveRetryWaitMs(body) / 1000);
    return `AJN proxy paused requests to this storage host. Retry in about ${secs} s`;
  }
  if (body.errorCode === 'AJN_UPSTREAM_HEADER_TIMEOUT' || body.errorCode === 'UND_ERR_CONNECT_TIMEOUT') {
    return 'Archive upstream timed out while waiting for response headers (HTTP 504)';
  }
  if (body.errorCode === 'AJN_PROXY_HEADER_BUDGET_EXHAUSTED') {
    return 'AJN proxy stopped after its 60 s total response-header wait budget';
  }
  if ([500, 502, 503, 504].includes(body.upstreamStatus ?? 0)) {
    return `Archive upstream returned HTTP ${body.upstreamStatus}`;
  }
  if (body.proxyHttpStatus === 504) {
    return 'AJN proxy returned HTTP 504; the upstream cause was not recorded';
  }
  if ((body.upstreamStatus ?? 0) === 0 && (body.attempts ?? 0) > 0) {
    return `AJN proxy received no upstream response after ${body.attempts} attempts`;
  }
  return body.error ?? `AJN proxy request failed${body.proxyHttpStatus ? ` (HTTP ${body.proxyHttpStatus})` : ''}`;
}

export function structuredArchiveWaitMessage(body: ProxyErrorBody): string {
  if (body.errorCode === 'AJN_UPSTREAM_CIRCUIT_OPEN') {
    return `AJN proxy circuit open; retry in about ${Math.ceil(archiveRetryWaitMs(body) / 1000)} s`;
  }
  if (body.errorCode === 'AJN_PROXY_HEADER_BUDGET_EXHAUSTED') {
    return 'AJN proxy exhausted its 60 s total response-header wait budget';
  }
  if (body.errorCode === 'AJN_UPSTREAM_HEADER_TIMEOUT' || body.errorCode === 'UND_ERR_CONNECT_TIMEOUT') {
    return 'Archive upstream response headers timed out (HTTP 504)';
  }
  if (body.proxyHttpStatus === 504) {
    return 'AJN proxy returned HTTP 504; upstream cause is not confirmed';
  }
  return body.error ?? 'Archive proxy reported a temporary playback failure';
}
