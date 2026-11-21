import assert from 'node:assert/strict';
const { isPodcastItem, isPodcastOnDemand, clampSkipTarget, skipLabel, skipAriaLabel, skipMedia, PENDING_SEEK_MS } = await import('./src/utils/podcastSkip.ts');

// which items get the buttons
assert.equal(isPodcastItem({ channelId: 'podcast-quash' }), true, 'episode list');
assert.equal(isPodcastItem({ channelId: 'pod-tucker-carlson' }), true, 'feed channel');
assert.equal(isPodcastItem({ channelId: 'pod-network-247' }), false, '24/7 stack is excluded');
assert.equal(isPodcastItem({ channelId: 'radio:wxyz' }), false, 'live radio');
assert.equal(isPodcastItem({ channelId: 'podcast-quash', isLive: true }), false, 'isLive wins');
assert.equal(isPodcastItem({ channelId: 'pod-x', programId: 'pod-x:live:1' }), false, ':live: programs');
assert.equal(isPodcastItem({ channelId: 'concert-pool-rock' }), false, 'concert');
assert.equal(isPodcastItem({ channelId: 'rush-vod' }), false, 'rush is not changed by this drop-in');
assert.equal(isPodcastItem(null), false); assert.equal(isPodcastItem(undefined), false);
// length gate
assert.equal(isPodcastOnDemand({ channelId: 'podcast-a' }, 3000), true);
for (const d of [NaN, Infinity, 0, 1]) assert.equal(isPodcastOnDemand({ channelId: 'podcast-a' }, d), false, 'duration ' + d);
// clamp
assert.equal(clampSkipTarget(5000, 3000), 2999.5, 'stops 0.5 s before the end');
assert.equal(clampSkipTarget(-20, 3000), 0, 'never negative');
assert.equal(clampSkipTarget(10, 1.2), 0.7, 'short track stays inside');
assert.equal(clampSkipTarget(10, NaN), null); assert.equal(clampSkipTarget(10, 0.5), null);
// labels
assert.deepEqual([15, 30, 60, -15].map(skipLabel), ['+15s', '+30s', '+60s', '-15s']);
assert.equal(skipAriaLabel(60), 'Skip forward 1 minute'); assert.equal(skipAriaLabel(30), 'Skip forward 30 seconds'); assert.equal(skipAriaLabel(-15), 'Skip back 15 seconds');

// rapid taps stack even when currentTime has not moved yet (range slice still loading)
class FakeMedia extends EventTarget {
  duration = 3000; private _t = 100; sets: number[] = []; stuck = true;
  get currentTime() { return this.stuck ? 100 : this._t; }
  set currentTime(v: number) { this.sets.push(v); this._t = v; }
}
const m = new FakeMedia() as unknown as HTMLMediaElement & { sets: number[]; stuck: boolean };
assert.equal(skipMedia(m, 30, 1000), 130);
assert.equal(skipMedia(m, 30, 1400), 160, 'second tap adds onto the target, not the stale 100');
assert.equal(skipMedia(m, -15, 1800), 145, 'rewind adds onto the target too');
assert.deepEqual(m.sets, [130, 160, 145]);
// after the playhead arrives ('seeked' near the target) the element is trusted again
m.stuck = false; (m as unknown as EventTarget).dispatchEvent(new Event('seeked'));
assert.equal(skipMedia(m, 30, 1900), 175, 'reads the real currentTime (145) after seeked');
// a tap later than the window re-reads currentTime
m.stuck = true; // pretend the clock still says 100
assert.equal(skipMedia(m, 30, 1900 + PENDING_SEEK_MS + 1), 130, 'expired target is ignored');
// end of episode and unusable media
const e = new FakeMedia() as unknown as HTMLMediaElement; (e as unknown as FakeMedia).duration = 200;
assert.equal(skipMedia(e, 60, 5000), 160); assert.equal(skipMedia(e, 60, 5100), 199.5, 'clamped before the end');
const live = new FakeMedia() as unknown as HTMLMediaElement; (live as unknown as FakeMedia).duration = Infinity;
assert.equal(skipMedia(live, 30, 1), null, 'live/unknown length does nothing');
console.log('test-podcast-skip OK');
