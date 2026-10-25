import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAX_CONSECUTIVE_PLAYBACK_FAILURES, shouldHoldForArchiveOutage, shouldStopAfterConsecutiveFailures } from './src/utils/playbackFailurePolicy.ts';
import { ARCHIVE_OUTAGE_RETRY_MS, retryStartAtSeconds, scheduleArchiveOutageRetry } from './src/utils/archiveOutageRetry.ts';

assert.equal(MAX_CONSECUTIVE_PLAYBACK_FAILURES, 3);
assert.equal(shouldStopAfterConsecutiveFailures(0), false);
assert.equal(shouldStopAfterConsecutiveFailures(1), false);
assert.equal(shouldStopAfterConsecutiveFailures(2), false);
assert.equal(shouldStopAfterConsecutiveFailures(3), true);
assert.equal(shouldStopAfterConsecutiveFailures(4), true);
assert.equal(shouldStopAfterConsecutiveFailures(Number.NaN), false);
assert.equal(shouldHoldForArchiveOutage('down', true), true);
assert.equal(shouldHoldForArchiveOutage('unreachable_from_here', true), true);
assert.equal(shouldHoldForArchiveOutage('down', true, false, 90_000, 100_000), false, 'recent Archive progress prevents pausing active playback');
assert.equal(shouldHoldForArchiveOutage('down', true, false, 79_999, 100_000), true, 'stale progress does not mask a later outage');
assert.equal(shouldHoldForArchiveOutage('unreachable_from_here', true, false, 99_999, 100_000), false, 'recent Archive progress prevents an outage hold even when the control probe failed');
assert.equal(shouldHoldForArchiveOutage('unreachable_from_here', true, false, 79_999, 100_000), true, 'stale Archive progress does not mask an unreachable state');
assert.equal(shouldHoldForArchiveOutage('down', true, true), false, 'a definite item failure still follows the normal skip policy');
assert.equal(shouldHoldForArchiveOutage('down', false), false, 'non-Archive playback is not paused');
assert.equal(shouldHoldForArchiveOutage('unknown', true), false, 'a failed status poll never implies an outage');

assert.equal(ARCHIVE_OUTAGE_RETRY_MS, 30_000);
assert.equal(retryStartAtSeconds(45.25, 42), 45.25, 'retry resumes at the media element position');
assert.equal(retryStartAtSeconds(20, 42), 20, 'the current element position wins after a deliberate backward seek');
assert.equal(retryStartAtSeconds(0, 42), 42, 'retry falls back to the last observed progress');
assert.equal(retryStartAtSeconds(0, 0), null, 'no position is invented');
let scheduled: (() => void) | null = null;
let scheduledDelay = 0;
let cleared = 0;
let retryCalls = 0;
const cancelRetry = scheduleArchiveOutageRetry({
  onRetry: () => { retryCalls++; },
  setTimeoutImpl: (callback, delay) => { scheduled = callback; scheduledDelay = delay; return 'fake-timer'; },
  clearTimeoutImpl: (handle) => { assert.equal(handle, 'fake-timer'); cleared++; },
});
assert.equal(scheduledDelay, 30_000, 'the one-shot retry waits 30 seconds');
scheduled?.();
scheduled?.();
assert.equal(retryCalls, 1, 'a single outage pause schedules only one retry');
cancelRetry();
assert.equal(cleared, 1);
let cancelledCallback: (() => void) | null = null;
const cancelBeforeFire = scheduleArchiveOutageRetry({
  onRetry: () => { retryCalls++; },
  setTimeoutImpl: (callback) => { cancelledCallback = callback; return 2; },
  clearTimeoutImpl: () => {},
});
cancelBeforeFire();
cancelledCallback?.();
assert.equal(retryCalls, 1, 'cancellation prevents retry after item change or unmount');

const playerView = readFileSync(new URL('./src/components/PlayerView.tsx', import.meta.url), 'utf8');
assert.match(playerView, /const onError = useCallback\(async \(err: MediaError \| null, proxyFailure\?/);
assert.match(playerView, /event: "playback\.skip_failed"/);
assert.match(playerView, /archiveIdentifier: archiveIdentifierFromPath\(mediaPath\)/);
assert.match(playerView, /role="alert" data-testid="playback-stopped-after-failures"/);
assert.match(playerView, /Retry this item/);
assert.match(playerView, /failedMedia\?\.pause\(\)/);
assert.match(playerView, /shouldHoldForArchiveOutage\(latestStatus\.state, true, itemSpecificFailure, getLastArchiveProgressAt\(nowPlaying\.src \?\? nowPlaying\.archivePath\)\)/);
assert.match(playerView, /retryCurrent\(\)/);
assert.match(playerView, /data-testid="archive-playback-paused"/);
assert.match(playerView, /retryPlayerMedia/);
assert.match(playerView, /scheduleArchiveOutageRetry/);
assert.match(playerView, /retryStartAtSeconds\([\s\S]*getLastArchiveProgressPosition\(current\?\.src \?\? current\?\.archivePath\)/);
assert.match(playerView, /nowPlaying=\{retryPlayerMedia\}/);

console.log('playback failure policy: PASS (3+ cap; recent-progress bypass; bounded retry; position-preserving remount)');
