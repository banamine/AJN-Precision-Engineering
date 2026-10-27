export const ARCHIVE_OUTAGE_RETRY_MS = 30_000;

export interface ArchiveOutageRetryOptions {
  onRetry: () => void;
  delayMs?: number;
  setTimeoutImpl?: (callback: () => void, delayMs: number) => unknown;
  clearTimeoutImpl?: (handle: unknown) => void;
}

/** One bounded retry timer. The caller reschedules only after the item fails again. */
export function scheduleArchiveOutageRetry({
  onRetry,
  delayMs = ARCHIVE_OUTAGE_RETRY_MS,
  setTimeoutImpl = (callback, delay) => setTimeout(callback, delay),
  clearTimeoutImpl = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}: ArchiveOutageRetryOptions): () => void {
  let cancelled = false;
  let fired = false;
  const handle = setTimeoutImpl(() => {
    if (cancelled || fired) return;
    fired = true;
    onRetry();
  }, delayMs);
  return () => {
    cancelled = true;
    clearTimeoutImpl(handle);
  };
}

export function retryStartAtSeconds(mediaTime: number | null | undefined, lastProgress: number | null): number | null {
  if (typeof mediaTime === 'number' && Number.isFinite(mediaTime) && mediaTime > 1) return mediaTime;
  return typeof lastProgress === 'number' && Number.isFinite(lastProgress) && lastProgress > 1
    ? lastProgress
    : null;
}
