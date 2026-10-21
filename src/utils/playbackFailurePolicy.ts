export const MAX_CONSECUTIVE_PLAYBACK_FAILURES = 3;

export function shouldStopAfterConsecutiveFailures(failures: number): boolean {
  return Number.isFinite(failures) && failures >= MAX_CONSECUTIVE_PLAYBACK_FAILURES;
}
