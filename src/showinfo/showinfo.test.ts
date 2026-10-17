import assert from 'node:assert/strict';
import {
  createShowInfoLookup,
  getShowInfoByArchiveIdentifier,
  getShowInfoByChannelId,
  SHOW_INFO_COUNT,
  SHOW_INFO_FILE,
} from './lookup';
import { getShowInfoErrors, validateShowInfoFile } from './validate';
import type { ShowInfoFile } from './types';

assert.ok(SHOW_INFO_FILE, 'the supplied showInfo.json validates');
assert.equal(SHOW_INFO_COUNT, 104);

const showInfoFile = SHOW_INFO_FILE as ShowInfoFile;
assert.ok(validateShowInfoFile(showInfoFile));
assert.equal(new Set(showInfoFile.shows.map((show) => show.id)).size, showInfoFile.shows.length);
assert.ok(showInfoFile.shows.every((show) =>
  show.links.imdbUrl === null
  || /^https:\/\/www\.imdb\.com\/title\/tt\d{7,9}\/$/.test(show.links.imdbUrl)));
assert.ok(showInfoFile.shows.every((show) => show.links.channelIds.every((id) => typeof id === 'string')));

assert.equal(getShowInfoByChannelId('classic-series-taxi')?.title, 'Taxi');
assert.equal(getShowInfoByChannelId('classic-hogans')?.title, "Hogan's Heroes");
assert.equal(getShowInfoByChannelId('classic-the-fugitive')?.title, 'The Fugitive');
assert.equal(getShowInfoByChannelId('channel-that-does-not-exist'), undefined);
assert.ok(getShowInfoByArchiveIdentifier('1600.-penn.-s-01-e-07.-hdtv.x-264'));

const changedFile = (change: (copy: ShowInfoFile) => void): unknown => {
  const copy = structuredClone(showInfoFile);
  change(copy);
  return copy;
};
const isRejected = (value: unknown) => getShowInfoErrors(value).length > 0;

assert.equal(isRejected({ ...showInfoFile, schema: 'ajn.showInfo.v2' }), true, 'reject wrong schema');
assert.equal(isRejected({ ...showInfoFile, count: showInfoFile.count + 1 }), true, 'reject count mismatch');
assert.equal(isRejected(changedFile((copy) => {
  copy.shows[1].id = copy.shows[0].id;
})), true, 'reject duplicate ids');
assert.equal(isRejected(changedFile((copy) => {
  copy.shows[0].genres = ['Drama', 'Comedy', 'Action', 'Mystery'];
})), true, 'reject more than three genres');
assert.equal(isRejected(changedFile((copy) => {
  copy.shows[0].cast = Array.from({ length: 7 }, (_, index) => ({ name: `Name ${index}`, role: 'Role' }));
})), true, 'reject more than six cast members');
assert.equal(isRejected(changedFile((copy) => {
  copy.shows[0].blurb = 'x'.repeat(91);
})), true, 'reject blurb over 90 characters');
assert.equal(isRejected(changedFile((copy) => {
  copy.shows[0].overview = 'x'.repeat(141);
})), true, 'reject overview over 140 characters');
assert.equal(isRejected(changedFile((copy) => {
  copy.shows[0].details.note = 'x'.repeat(401);
})), true, 'reject details note over 400 characters');
assert.equal(isRejected({ ...showInfoFile, note: 'x'.repeat(401) }), true, 'reject file note over 400 characters');
assert.equal(isRejected(changedFile((copy) => {
  copy.shows[0].links.imdbUrl = 'https://www.imdb.com/title/tt123/';
})), true, 'reject invalid IMDb URL');
assert.equal(isRejected(changedFile((copy) => {
  copy.shows[0].source.url = 'https://www.tvmaze.com.evil.example/shows/1/example';
})), true, 'reject invalid TVmaze URL');
assert.equal(isRejected(changedFile((copy) => {
  copy.shows[0].status = 'unverified' as 'verified';
})), true, 'reject non-verified show status');
assert.ok(validateShowInfoFile({
  ...showInfoFile,
  arbitraryExtraField: true,
  _internalNote: 'ignored extra data',
}), 'tolerate unknown extra fields');

let invalidFileLogCount = 0;
const invalidLookup = createShowInfoLookup(
  { ...showInfoFile, schema: 'invalid' },
  () => { invalidFileLogCount += 1; },
);
assert.equal(invalidFileLogCount, 1, 'log one error for an invalid file');
assert.equal(invalidLookup.file, null);
assert.equal(invalidLookup.count, 0);
assert.equal(invalidLookup.getShowInfoByChannelId('classic-hogans'), undefined);
assert.doesNotThrow(() => createShowInfoLookup(null, () => { invalidFileLogCount += 1; }));
assert.equal(invalidFileLogCount, 2);

console.log('[showinfo] PASS — supplied data validation, limits, URLs, lookups, and invalid-file fallback');
