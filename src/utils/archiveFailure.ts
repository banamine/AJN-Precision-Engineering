/* Reads the proxy's JSON error for a failed Archive file and says what kind of failure it is.
 * The proxy already retried 3 times before it answered (attempts), so when Archive itself is overloaded
 * (HTTP 500/502/504 from its storage node, or no answer at all after those attempts) more automatic retries
 * only add load and make the person wait minutes. Say so plainly instead. */
export interface ProxyErrorBody { error?: string; reason?: string; upstreamStatus?: number; attempts?: number; proxyRequestId?: string }
export type ArchiveFailure = 'definite' | 'overloaded' | 'transient';

export function classifyArchiveFailure(httpStatus: number, body: ProxyErrorBody): ArchiveFailure {
  const up = body.upstreamStatus ?? 0;
  if (body.reason === 'UNPLAYABLE_ARCHIVE_MEMBER' || [403, 404, 410].includes(up) || httpStatus === 400 || httpStatus === 422) return 'definite';
  if ([500, 502, 504].includes(up)) return 'overloaded';
  if (up === 0 && httpStatus >= 500 && (body.attempts ?? 0) >= 3) return 'overloaded';
  return 'transient';
}

export function overloadedMessage(body: ProxyErrorBody): string {
  const up = body.upstreamStatus ? ` (HTTP ${body.upstreamStatus})` : '';
  return `Archive's servers are overloaded right now${up}. Try again in a few minutes`;
}
