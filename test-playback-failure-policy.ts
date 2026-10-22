import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAX_CONSECUTIVE_PLAYBACK_FAILURES, shouldHoldForArchiveOutage, shouldStopAfterConsecutiveFailures } from './src/utils/playbackFailurePolicy.ts';

assert.equal(MAX_CONSECUTIVE_PLAYBACK_FAILURES, 3);
assert.equal(shouldStopAfterConsecutiveFailures(0), false);
assert.equal(shouldStopAfterConsecutiveFailures(1), false);
assert.equal(shouldStopAfterConsecutiveFailures(2), false);
assert.equal(shouldStopAfterConsecutiveFailures(3), true);
assert.equal(shouldStopAfterConsecutiveFailures(4), true);
assert.equal(shouldStopAfterConsecutiveFailures(Number.NaN), false);
assert.equal(shouldHoldForArchiveOutage('down', true), true);
assert.equal(shouldHoldForArchiveOutage('unreachable_from_here', true), true);
assert.equal(shouldHoldForArchiveOutage('down', true, true), false, 'a definite item failure still follows the normal skip policy');
assert.equal(shouldHoldForArchiveOutage('down', false), false, 'non-Archive playback is not paused');
assert.equal(shouldHoldForArchiveOutage('unknown', true), false, 'a failed status poll never implies an outage');

const playerView = readFileSync(new URL('./src/components/PlayerView.tsx', import.meta.url), 'utf8');
assert.match(playerView, /const onError = useCallback\(async \(err: MediaError \| null, proxyFailure\?/);
assert.match(playerView, /event: "playback\.skip_failed"/);
assert.match(playerView, /archiveIdentifier: archiveIdentifierFromPath\(mediaPath\)/);
assert.match(playerView, /role="alert" data-testid="playback-stopped-after-failures"/);
assert.match(playerView, /Retry this item/);
assert.match(playerView, /failedMedia\?\.pause\(\)/);
assert.match(playerView, /shouldHoldForArchiveOutage\(latestStatus\.state, true, itemSpecificFailure\)/);
assert.match(playerView, /retryCurrent\(\)/);
assert.match(playerView, /data-testid="archive-playback-paused"/);

console.log('playback failure policy: PASS (3+ cap; outage pauses Archive media; definite and non-Archive failures unchanged)');
