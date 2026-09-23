// Regression: Archive URLs are used exactly as given (no decode, re-encode or guessing).
import assert from 'node:assert/strict';
import { getSafeArchiveUrl } from './channels.ts';

const exact = [
  'https://archive.org/download/daily-highlights/m3u_split_shows_2026-08-05%20%281%29/split_shows/Show%20Name%20%231.mp4',
  'https://archive.org/download/x/A+B%2BC.mp4',
  'https://archive.org/download/x/100%25_real.mp4',
  'https://archive.org/download/x/Vol...1.mp4',
  'https://archive.org/download/x/clip.mp4?start=0&end=300',
  'https://archive.org/download/daily-highlights/m3u_split_shows_2026-08-05%20%281%29/split_shows/',
];
for (const url of exact) assert.equal(getSafeArchiveUrl(url), url, `changed: ${url}`);

assert.equal(getSafeArchiveUrl('http://archive.org/download/x/a%20b.mp4'), 'https://archive.org/download/x/a%20b.mp4');
assert.equal(
  getSafeArchiveUrl('https://ia800.us.archive.org/12/items/abc/My%20File%20(1).mp4?start=0&end=300'),
  'https://archive.org/download/abc/My%20File%20(1).mp4?start=0&end=300',
);
console.log('archive exact-URL regression: all passed');
