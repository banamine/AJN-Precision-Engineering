import { ARCHIVE_PROGRESS_WINDOW_MS, shouldShowOutageBanner } from './archivePlaybackEvidence';

export const MAX_CONSECUTIVE_PLAYBACK_FAILURES = 3;

export function shouldStopAfterConsecutiveFailures(failures: number): boolean {
  return Number.isFinite(failures) && failures >= MAX_CONSECUTIVE_PLAYBACK_FAILURES;
}

export function shouldHoldForArchiveOutage(
  state: 'ok' | 'degraded' | 'down' | 'unreachable_from_here' | 'unknown',
  isArchiveMedia: boolean,
  itemSpecificFailure = false,
  lastArchiveProgressAt: number | null = null,
  now = Date.now(),
): boolean {
  return isArchiveMedia
    && !itemSpecificFailure
    && (state === 'down' || state === 'unreachable_from_here')
    && shouldShowOutageBanner(state, now, lastArchiveProgressAt, ARCHIVE_PROGRESS_WINDOW_MS);
}
