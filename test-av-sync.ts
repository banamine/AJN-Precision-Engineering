// Regression: Parallel Audio/Video Sync rules (pure). Twin lookup, start offsets, shared position store, drift.
import assert from 'node:assert/strict';
import { buildRadioCatalog, type RadioFeedItem } from './src/utils/ajnRadioCatalog.ts';
import { baseIdOf, videoIdOf, twinFor, clampStart, pickSwitchStart, needsDriftCorrection, createPositionStore, AVSYNC_STORAGE_KEY, AVSYNC_MAX_ENTRIES } from './src/utils/avSync.ts';

const A = 'https://archive.alexjoneslive.com/hourly-mp3/';
const V = 'https://archive.alexjoneslive.com/hourly-m4v/';
const a = (id: string, file: string): RadioFeedItem => ({ id, title: id, url: `${A}${file}`, mediaType: 'audio' });
const v = (id: string, file: string): RadioFeedItem => ({ id, title: id, url: `${V}${file}`, mediaType: 'video' });
const cat = buildRadioCatalog([a('1', '20261002_Fri_Alex-Hr1.mp3'), a('2', '20261002_Fri_Alex-Hr2.mp3'), v('v1', '20261002_Fri_Alex-Hr1.m4v')]);
const entries = [...cat.radio, ...cat.exclusive];

// ids
assert.equal(baseIdOf('1:video'), '1');
assert.equal(baseIdOf('1'), '1');
assert.equal(baseIdOf(undefined), null);
assert.equal(videoIdOf('1'), '1:video');

// twin lookup: both directions, never guessed
const toVideo = twinFor(entries, '1', 'audio');
assert.deepEqual([toVideo?.target, toVideo?.url, toVideo?.programId], ['video', `${V}20261002_Fri_Alex-Hr1.m4v`, '1:video']);
const toAudio = twinFor(entries, '1:video', 'video');
assert.deepEqual([toAudio?.target, toAudio?.url, toAudio?.programId], ['audio', `${A}20261002_Fri_Alex-Hr1.mp3`, '1']);
assert.equal(twinFor(entries, '2', 'audio'), null, 'audio with no paired video has no twin');
assert.equal(twinFor(entries, 'nope', 'audio'), null, 'not an AJN item');
assert.equal(twinFor(entries, '1', 'video'), null, 'id and media type disagree -> not ours');
assert.equal(twinFor(entries, undefined, 'audio'), null);

// start offsets
assert.equal(clampStart(600), 600);
assert.equal(clampStart(600.04), 600);
assert.equal(clampStart(0.4), null, 'under a second: start from the beginning');
assert.equal(clampStart(NaN), null);
assert.equal(clampStart(-5), null);
assert.equal(clampStart(null), null);
assert.equal(clampStart(3599, 3600), null, 'finished episode: no seek to the end');
assert.equal(clampStart(1800, 3600), 1800);
assert.equal(pickSwitchStart(600, 120, 3600), 600, 'live playhead beats the saved one');
assert.equal(pickSwitchStart(null, 120, 3600), 120, 'saved position is the fallback');
assert.equal(pickSwitchStart(0, 120), null, 'a live playhead at 0 means the listener restarted: do not jump to an old saved spot');
assert.equal(pickSwitchStart(null, null), null);

// drift
assert.equal(needsDriftCorrection(600.2, 600), false);
assert.equal(needsDriftCorrection(601, 600), true);
assert.equal(needsDriftCorrection(NaN, 600), false);

// position store: shared by audio and video ids
const mem = new Map<string, string>();
const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, val: string) => { mem.set(k, val); } };
let t = 1000;
const store = createPositionStore(storage, () => t);
assert.equal(store.read('1'), null);
assert.equal(store.save('1', 600.04), true);
assert.equal(store.read('1'), 600);
assert.equal(store.read('1:video'), 600, 'video id reads the same record');
t = 2000; store.save('1:video', 640);
assert.equal(store.read('1'), 640, 'video id writes the same record');
assert.equal(store.save('1', NaN), false);
assert.equal(store.save(undefined, 5), false);
store.clear('1:video');
assert.equal(store.read('1'), null);
mem.set(AVSYNC_STORAGE_KEY, '{not json');
assert.equal(createPositionStore(storage).read('1'), null, 'corrupt storage is ignored');
mem.set(AVSYNC_STORAGE_KEY, JSON.stringify({ x: { seconds: 'a', updatedAt: 1 }, y: { seconds: 5, updatedAt: 2 } }));
assert.equal(createPositionStore(storage).read('x'), null);
assert.equal(createPositionStore(storage).read('y'), 5);
const throwing = createPositionStore({ getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
assert.equal(throwing.read('1'), null);
assert.equal(throwing.save('1', 5), false);
assert.equal(createPositionStore(null).read('1'), null);

// cap: oldest records dropped
mem.clear();
const capped = createPositionStore(storage, () => ++t);
for (let i = 0; i < AVSYNC_MAX_ENTRIES + 25; i++) capped.save(`ep${i}`, 10 + i);
assert.equal(capped.read('ep0'), null, 'oldest dropped');
assert.equal(capped.read(`ep${AVSYNC_MAX_ENTRIES + 24}`), 10 + AVSYNC_MAX_ENTRIES + 24, 'newest kept');
assert.equal(Object.keys(JSON.parse(mem.get(AVSYNC_STORAGE_KEY)!)).length, AVSYNC_MAX_ENTRIES);

console.log('test-av-sync: all checks passed');
