export const MAX_CONSECUTIVE_PLAYBACK_FAILURES = 3;

export function shouldStopAfterConsecutiveFailures(failures: number): boolean {
  return Number.isFinite(failures) && failures >= MAX_CONSECUTIVE_PLAYBACK_FAILURES;
}

export function shouldHoldForArchiveOutage(
  state: 'ok' | 'degraded' | 'down' | 'unreachable_from_here' | 'unknown',
  isArchiveMedia: boolean,
  itemSpecificFailure = false,
): boolean {
  return isArchiveMedia
    && !itemSpecificFailure
    && (state === 'down' || state === 'unreachable_from_here');
}
