import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAX_CONSECUTIVE_PLAYBACK_FAILURES, shouldStopAfterConsecutiveFailures } from './src/utils/playbackFailurePolicy.ts';

assert.equal(MAX_CONSECUTIVE_PLAYBACK_FAILURES, 3);
assert.equal(shouldStopAfterConsecutiveFailures(0), false);
assert.equal(shouldStopAfterConsecutiveFailures(1), false);
assert.equal(shouldStopAfterConsecutiveFailures(2), false);
assert.equal(shouldStopAfterConsecutiveFailures(3), true);
assert.equal(shouldStopAfterConsecutiveFailures(4), true);
assert.equal(shouldStopAfterConsecutiveFailures(Number.NaN), false);

const playerView = readFileSync(new URL('./src/components/PlayerView.tsx', import.meta.url), 'utf8');
assert.match(playerView, /onError = useCallback\(\(err: MediaError \| null, proxyFailure\?/);
assert.match(playerView, /event: "playback\.skip_failed"/);
assert.match(playerView, /archiveIdentifier: archiveIdentifierFromPath\(mediaPath\)/);
assert.match(playerView, /role="alert" data-testid="playback-stopped-after-failures"/);
assert.match(playerView, /Retry this item/);
assert.match(playerView, /failedMedia\?\.pause\(\)/);

console.log('playback failure stop policy: PASS (continues at 0–2, stops at 3+)');
