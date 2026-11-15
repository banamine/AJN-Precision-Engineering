// A thumbnail request that never loads or errors must not hold a lane slot forever.
// Before the lease timeout, THUMBNAIL_LANE_LIMIT stalled requests blocked every other thumbnail and logo.
import assert from 'node:assert/strict';
import { enqueueThumbnailLoad, thumbnailLaneStats, thumbnailLaneConfig, THUMBNAIL_LANE_LIMIT } from './src/utils/thumbnailLane';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
thumbnailLaneConfig.leaseTimeoutMs = 60;

// 1. Fill every slot with requests that never release (stalled hosts).
const stalled: boolean[] = [];
for (let i = 0; i < THUMBNAIL_LANE_LIMIT; i += 1) enqueueThumbnailLoad(() => { stalled[i] = true; });
assert.equal(thumbnailLaneStats().active, THUMBNAIL_LANE_LIMIT, 'all slots taken by stalled requests');

// 2. A healthy request queued behind them must still get its turn.
let healthyGranted = false;
let healthyRelease: (() => void) | undefined;
enqueueThumbnailLoad((release) => { healthyGranted = true; healthyRelease = release; });
assert.equal(healthyGranted, false, 'healthy request waits while the lane is full');
await sleep(150);
assert.equal(healthyGranted, true, 'healthy request is granted after the stalled leases time out');

// 3. A late release from a timed-out request must not free a second slot (no double release).
healthyRelease?.();
healthyRelease?.();
await sleep(100);
assert.equal(thumbnailLaneStats().active, 0, 'every slot returned, counter never negative');

// 4. A normal request that releases in time is unaffected and its timer is cleared.
let normalRelease: (() => void) | undefined;
enqueueThumbnailLoad((release) => { normalRelease = release; });
normalRelease?.();
assert.equal(thumbnailLaneStats().active, 0);
await sleep(100);
assert.equal(thumbnailLaneStats().active, 0, 'cleared timer does not release again');

console.log('ok thumbnail lane: stalled requests cannot starve the queue');
