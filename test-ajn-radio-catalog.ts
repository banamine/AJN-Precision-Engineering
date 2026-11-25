// Regression: Radio catalog split (AJN Radio vs AJN Exclusive), dedupe, ordering, and video pairing.
import assert from 'node:assert/strict';
import { buildRadioCatalog, type RadioFeedItem } from './src/utils/ajnRadioCatalog.ts';
import { showChips, typeChips, filterEntries, neighbour, isPlayingEntry, formatClock, UNSORTED } from './src/utils/ajnRadioBrowse.ts';

const A = 'https://archive.alexjoneslive.com/hourly-mp3/';
const V = 'https://archive.alexjoneslive.com/hourly-m4v/';
const a = (id: string, file: string, title = id): RadioFeedItem => ({ id, title, url: `${A}${file}`, mediaType: 'audio' });
const v = (id: string, file: string): RadioFeedItem => ({ id, title: id, url: `${V}${file}`, mediaType: 'video' });

const cat = buildRadioCatalog([
  a('1', '20261002_Fri_Alex-Hr1.mp3'),
  a('2', '20261002_Fri_Alex-Hr2.mp3'),
  a('2dup', '20261002_Fri_Alex-Hr2.mp3'),            // same file from another feed -> one episode
  a('3', '20261001_Thu_WarRoom-Hr1.mp3'),
  a('4', '20261003_Sat_Alex-Special.mp3'),             // Exclusive
  a('5', 'mystery.mp3', 'Mystery upload'),            // unclassifiable: kept, flagged, last
  v('v1', '20261002_Fri_Alex-Hr1.m4v'),
  v('v4', '20261003_Sat_Alex-Special.m4v'),
]);

assert.deepEqual(cat.exclusive.map(e => e.id), ['4']);
assert.equal(cat.exclusive[0].videoUrl, `${V}20261003_Sat_Alex-Special.m4v`);
assert.deepEqual(cat.radio.map(e => e.id), ['2', '1', '3', '5'], 'newest date first, later hour first, undated last, duplicates removed');
assert.equal(cat.radio[1].videoUrl, `${V}20261002_Fri_Alex-Hr1.m4v`);
assert.equal(cat.radio[0].videoUrl, null, 'no video twin -> null, never guessed');
const mystery = cat.radio[3];
assert.deepEqual([mystery.needsReview, mystery.airDate, mystery.title], [true, null, 'Mystery upload']);
assert.equal(cat.radio[0].title, 'Alex Jones — Hour 2 — Fri Oct 2, 2026');
assert.deepEqual(buildRadioCatalog([]), { radio: [], exclusive: [] });
// --- browsing: chips, sort, search, neighbours
const none = { show: null, type: null, query: '', sort: 'newest' as const };
assert.deepEqual(showChips(cat.radio).map(c => [c.key, c.count]), [['alex-jones', 2], ['war-room', 1], [UNSORTED, 1]], 'show chips in fixed order, unsorted last, with counts');
assert.deepEqual(typeChips(cat.radio).map(c => c.key), ['hour', UNSORTED]);
assert.deepEqual(showChips(cat.exclusive), [], 'a single value would not narrow anything: no chips');
assert.deepEqual(filterEntries(cat.radio, none).map(e => e.id), ['2', '1', '3', '5']);
assert.deepEqual(filterEntries(cat.radio, { ...none, sort: 'oldest' }).map(e => e.id), ['3', '1', '2', '5'], 'oldest first; undated stays last');
assert.deepEqual(filterEntries(cat.radio, { ...none, show: 'war-room' }).map(e => e.id), ['3']);
assert.deepEqual(filterEntries(cat.radio, { ...none, show: UNSORTED }).map(e => e.id), ['5']);
assert.deepEqual(filterEntries(cat.radio, { ...none, query: ' HOUR 2 ' }).map(e => e.id), ['2'], 'title search is case-insensitive and trimmed');
assert.deepEqual(filterEntries(cat.radio, { ...none, query: 'zzz' }), []);
assert.deepEqual(filterEntries(cat.radio, { ...none, show: 'alex-jones', type: 'hour', query: 'hour 1' }).map(e => e.id), ['1']);
assert.equal(neighbour(cat.radio, '2', 1)?.id, '1');
assert.equal(neighbour(cat.radio, '2', -1), null, 'no previous before the first');
assert.equal(neighbour(cat.radio, '1:video', 1)?.id, '3', 'a playing video counts as its audio entry');
assert.equal(neighbour(cat.radio, 'not-in-list', 1), null);
assert.ok(isPlayingEntry(cat.radio[1], '1:video') && !isPlayingEntry(cat.radio[1], undefined));
assert.deepEqual([formatClock(0), formatClock(65), formatClock(3725), formatClock(NaN)], ['0:00', '1:05', '1:02:05', '—']);
console.log('ajn radio catalog regression: all passed');
