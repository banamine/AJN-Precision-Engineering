// Police Chase reel: pure logic (clip list, shuffle, random preview start, concurrency cap, scroll step).
import assert from 'node:assert/strict';
import { getFoxClipsChannels } from './server/foxClips.ts';
import { clipsFromChannels, shuffled, previewStart, pickPlaying, scrollStep, MAX_PLAYING, PREVIEW_SECONDS, POLICE_CHASE_CHANNEL_ID } from './src/guide/policeChase.ts';

const chs = getFoxClipsChannels('cable-tv', new Date('2026-10-14T12:00:00Z'));
const clips = clipsFromChannels(chs);
assert.equal(clips.length, 16, 'one entry per clip even though the day repeats them');
assert.equal(new Set(clips.map((c) => c.key)).size, 16);
assert.ok(clips.every((c) => c.url.startsWith('https://static-clips.fox.com/') && c.seconds >= 20 && c.thumb?.startsWith('https://')));
assert.equal(clips[0].program.channelId, POLICE_CHASE_CHANNEL_ID);
assert.deepEqual(clipsFromChannels([]), []); assert.deepEqual(clipsFromChannels([{ ...chs[0], id: 'other' }]), [], 'other channels ignored');
const evil = { ...chs[0], programs: [{ ...chs[0].programs[0], mediaUrl: 'http://x.example/a.mp4' }, { ...chs[0].programs[1], mediaUrl: 'https://x.example/a.m3u8' }] };
assert.deepEqual(clipsFromChannels([evil]), [], 'only https mp4 are shown');

// Shuffle: a permutation, deterministic with a seeded source, different orders for different seeds, input untouched.
const seeded = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const keys = clips.map((c) => c.key);
const a = shuffled(keys, seeded(1)), b = shuffled(keys, seeded(1)), c2 = shuffled(keys, seeded(2));
assert.deepEqual(a, b); assert.notDeepEqual(a, c2); assert.deepEqual([...a].sort(), [...keys].sort()); assert.deepEqual(keys, clips.map((c) => c.key));

// Preview start: inside 5%..95% minus the preview length, never past the end, and it really varies.
const starts = Array.from({ length: 400 }, (_, i) => previewStart(3575, seeded(i + 7)));
assert.ok(starts.every((s) => s >= 3575 * 0.05 - 0.1 && s + PREVIEW_SECONDS <= 3575 * 0.95 + 0.1), 'in range');
assert.ok(new Set(starts).size > 300, 'varies');
assert.equal(previewStart(5), 0); assert.equal(previewStart(0), 0); assert.equal(previewStart(NaN as any), 0);
assert.ok(previewStart(30, () => 0.999) + PREVIEW_SECONDS <= 30, 'short clip still has room for a whole preview');

// At most MAX_PLAYING previews, the first visible ones in on-screen order.
const order = ['a', 'b', 'c', 'd', 'e', 'f'];
assert.deepEqual([...pickPlaying(new Set(['b', 'c', 'd', 'e', 'f']), order)], ['b', 'c', 'd']); assert.equal(MAX_PLAYING, 3);
assert.deepEqual([...pickPlaying(new Set(), order)], []); assert.deepEqual([...pickPlaying(new Set(['e']), order)], ['e']);

// Scroll: moves forward, turns at both ends, no-ops when nothing overflows.
let st = { pos: 0, dir: 1 as 1 | -1 };
for (let i = 0; i < 100; i++) st = scrollStep(st.pos, st.dir, 100, 0.35);
assert.ok(Math.abs(st.pos - 35) < 0.01 && st.dir === 1, 'forward');
for (let i = 0; i < 400; i++) st = scrollStep(st.pos, st.dir, 100, 0.35);
assert.ok(st.pos >= 0 && st.pos <= 100, 'stays in range after bouncing');
assert.deepEqual(scrollStep(99.9, 1, 100, 0.35), { pos: 100, dir: -1 }); assert.deepEqual(scrollStep(0.1, -1, 100, 0.35), { pos: 0, dir: 1 });
assert.deepEqual(scrollStep(0, 1, 0, 0.35), { pos: 0, dir: 1 });
console.log('test-police-chase-reel: ok');
