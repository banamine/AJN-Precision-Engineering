export interface ArchiveProxyFailureBody {
  error: string;
  upstreamStatus: number;
  attempts: number;
  proxyRequestId: string;
  errorCode?: string;
  reason?: string;
  /** Circuit open only: seconds until the storage host may be asked again. */
  retryAfterSeconds?: number;
}

export interface ArchiveProxyFailureReply {
  status: 502 | 503 | 504;
  body: ArchiveProxyFailureBody;
}

interface CachedFailure extends ArchiveProxyFailureReply {
  expiresAt: number;
}

export const ARCHIVE_PROXY_FAILURE_TTL_MS = 30_000;
const MAX_FAILURES = 500;
const failures = new Map<string, CachedFailure>();

export function buildArchiveProxyFailureReply(input: {
  upstreamStatus: number;
  attempts: number;
  proxyRequestId: string;
  errorCode?: string;
  reason?: string;
  retryAfterMs?: number;
}): ArchiveProxyFailureReply {
  const timedOut = input.errorCode === 'UND_ERR_CONNECT_TIMEOUT'
    || input.errorCode === 'AJN_UPSTREAM_HEADER_TIMEOUT';
  const circuitOpen = input.errorCode === 'AJN_UPSTREAM_CIRCUIT_OPEN';
  const status: ArchiveProxyFailureReply['status'] = timedOut ? 504 : circuitOpen ? 503 : 502;
  return {
    status,
    body: {
      error: timedOut
        ? 'Archive upstream timed out'
        : circuitOpen
          ? 'Archive upstream temporarily unavailable'
          : 'Archive media request failed',
      upstreamStatus: input.upstreamStatus,
      attempts: input.attempts,
      proxyRequestId: input.proxyRequestId,
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
      ...(circuitOpen && input.retryAfterMs && input.retryAfterMs > 0 ? { retryAfterSeconds: Math.ceil(input.retryAfterMs / 1000) } : {}),
    },
  };
}

function prune(now: number): void {
  for (const [key, failure] of failures) {
    if (failure.expiresAt <= now) failures.delete(key);
  }
  while (failures.size > MAX_FAILURES) {
    const oldest = failures.keys().next().value as string | undefined;
    if (!oldest) break;
    failures.delete(oldest);
  }
}

/** Keep only small structured error metadata in memory; never cache upstream response text. */
export function rememberArchiveProxyFailure(
  path: string,
  reply: ArchiveProxyFailureReply,
  now = Date.now(),
): void {
  prune(now);
  failures.delete(path);
  failures.set(path, {
    status: reply.status,
    body: { ...reply.body },
    expiresAt: now + ARCHIVE_PROXY_FAILURE_TTL_MS,
  });
  prune(now);
}

/** Outage failures describe the site/network, not a permanently bad media item. */
export function rememberArchiveProxyFailureUnlessOutage(
  path: string,
  reply: ArchiveProxyFailureReply,
  state: string,
  now = Date.now(),
): boolean {
  const itemSpecific = [400, 403, 404, 410, 422].includes(reply.body.upstreamStatus)
    || reply.body.errorCode === 'UNPLAYABLE_ARCHIVE_MEMBER'
    || reply.body.reason === 'UNPLAYABLE_ARCHIVE_MEMBER';
  if (state === 'down' || state === 'unreachable_from_here' || itemSpecific) return false;
  rememberArchiveProxyFailure(path, reply, now);
  return true;
}

export function getRecentArchiveProxyFailure(
  path: string,
  now = Date.now(),
): ArchiveProxyFailureReply | null {
  prune(now);
  const failure = failures.get(path);
  return failure ? { status: failure.status, body: { ...failure.body } } : null;
}

export function clearArchiveProxyFailureCacheForTests(): void {
  failures.clear();
}
