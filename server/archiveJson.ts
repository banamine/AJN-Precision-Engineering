// Shared Archive JSON GET: every request gets its own timeout so one hung request
// can never hold a worker until an outer deadline (the Fox/MSNBC news refresh bug).
// Used by the news source now and by the Topics search service later.
export const ARCHIVE_REQUEST_TIMEOUT_MS = 15_000;
export const ARCHIVE_SLOW_REQUEST_MS = 5_000;
const DEFAULT_USER_AGENT = 'AJN-Precision-Engineering/ArchiveJson';

/** True when an error came from an abort or a timeout signal (not a network failure). */
export function isTimeoutError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

export interface ArchiveJsonOptions {
  /** Per-request timeout; default ARCHIVE_REQUEST_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Request kind for the slow-request log line, e.g. "search" or "metadata". */
  kind?: string;
  userAgent?: string;
}

export async function getArchiveJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  signal: AbortSignal,
  opts: ArchiveJsonOptions = {},
): Promise<{ status: number; body: T | null }> {
  const timeoutMs = opts.timeoutMs ?? ARCHIVE_REQUEST_TIMEOUT_MS;
  const started = Date.now();
  const sig = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  const init = { signal: sig, headers: { 'User-Agent': opts.userAgent ?? DEFAULT_USER_AGENT, Accept: 'application/json' } };
  try {
    let res = await fetchImpl(url, init);
    if (res.status === 429 && !sig.aborted) {
      // Rate limited: one polite retry, honoring Retry-After up to 5s.
      await res.body?.cancel().catch(() => {});
      const wait = Math.min(Number(res.headers.get('retry-after')) * 1000 || 1500, 5000);
      await new Promise((r) => setTimeout(r, wait));
      res = await fetchImpl(url, init);
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { status: res.status, body: null };
    }
    return { status: res.status, body: (await res.json()) as T };
  } finally {
    const ms = Date.now() - started;
    if (ms >= ARCHIVE_SLOW_REQUEST_MS) console.warn(`[Archive slow request] kind=${opts.kind ?? 'json'} ms=${ms} aborted=${sig.aborted}`);
  }
}
