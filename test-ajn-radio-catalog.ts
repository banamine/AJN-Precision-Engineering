// Regression: Radio catalog split (AJN Radio vs AJN Exclusive), dedupe, ordering, and video pairing.
import assert from 'node:assert/strict';
import { buildRadioCatalog, type RadioFeedItem } from './src/utils/ajnRadioCatalog.ts';

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
console.log('ajn radio catalog regression: all passed');
