// Regression: Cable TV guide is built from the Archive News contract with real air times.
import assert from 'node:assert/strict';
import { getScheduleForGuide, setCableNewsFetchForTests } from './guideRegistry.ts';

const today = new Date();
const stamp = (hoursAgo: number) => {
  const d = new Date(today.getTime() - hoursAgo * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}_${p(d.getUTCHours())}0000`;
};
const cnnId = `CNNW_${stamp(30)}_CNN_News_Central`;
const foxId = `FOXNEWSW_${stamp(40)}_Hannity`;

setCableNewsFetchForTests((async (input: any) => {
  const url = decodeURIComponent(String(input));
  const json = (status: number, body?: unknown) => new Response(body ? JSON.stringify(body) : '', { status });
  if (url.includes('advancedsearch')) {
    if (url.includes('collection:CNNW ')) return json(200, { response: { docs: [{ identifier: cnnId }] } });
    if (url.includes('collection:FOXNEWSW ')) return json(200, { response: { docs: [{ identifier: foxId }] } });
    if (url.includes('collection:MSNBCW ')) return json(503);
    return json(200, { response: { docs: [] } });
  }
  if (url.includes(`metadata/${cnnId}`)) return json(200, { metadata: { title: 'CNN News Central' }, files: [{ name: `${cnnId}.mp4`, source: 'derivative', length: '3600' }] });
  if (url.includes(`metadata/${foxId}`)) return json(200, { metadata: { 'access-restricted-item': 'true' }, files: [{ name: `${foxId}.mp4`, source: 'original', private: 'true', length: '3600' }] });
  return json(404);
}) as typeof fetch);

const channels = await getScheduleForGuide('cable-tv');
const by = Object.fromEntries(channels.map((c) => [c.id, c]));
assert.deepEqual(channels.map((c) => c.id), ['fox-news', 'cnn', 'msnbc', 'bbc', 'ntd', 'rt', 'kpix']);

const cnn = by['cnn'];
assert.equal(cnn.sourceStatus, 'ok');
// Always filled: the one known broadcast loops across today (24 x 1h), keeping its real air time.
assert.equal(cnn.programs.length, 24);
const prog = cnn.programs[0];
assert.equal(prog.title, 'CNN News Central');
assert.equal(prog.startTimeUtc!.slice(11), '00:00:00.000Z');
const aired = Date.parse((prog.metadata as any).airedUtc);
assert.ok(Math.abs(aired - (today.getTime() - 30 * 3600_000)) < 3600_000, 'real air time kept in metadata');
assert.equal(Date.parse(prog.endTimeUtc!) - Date.parse(prog.startTimeUtc!), 3600_000);
assert.equal(cnn.logo, 'https://archive.org/services/img/CNNW');

// Restricted TV News item -> 282s exact clips of the item-level MP4 (reference M3U format).
const fox = by['fox-news'];
assert.equal(fox.sourceStatus, 'ok');
// Clips are grouped into one full-length show block; clips ride in metadata.segments.
const show = fox.programs[0];
const segs = (show.metadata as any).segments;
assert.equal(fox.programs.length, 1, 'clips are grouped into one show block');
assert.ok(Array.isArray(segs), 'grouped show carries metadata.segments');
assert.ok(segs.length >= 13, 'one show block carries all its clips');
assert.equal(show.archivePath, `/download/${foxId}/${foxId}.mp4?exact=1&start=0&end=282`);
assert.equal(segs[0].index, 0);
assert.equal(segs[1].index, 1);
assert.equal(segs[1].archivePath, `/download/${foxId}/${foxId}.mp4?exact=1&start=282&end=564`);
assert.ok(segs.every((s: any) => String(s.mediaUrl).startsWith('/api/archive/proxy?path=')), 'all segments are proxied');
assert.ok(segs.every((s: any, i: number) => i === 0 || s.start >= segs[i - 1].end), 'segments remain in chronological order');
assert.equal((show.metadata as any).durationSeconds, segs.reduce((n: number, s: any) => n + (s.end - s.start), 0), 'grouped duration equals segment durations');
assert.ok(Date.parse(show.endTimeUtc!) - Date.parse(show.startTimeUtc!) >= 55 * 60_000, 'show block is full length, not 4.7 min');
assert.ok(!/\d{2}:\d{2}$/.test(show.title), 'title has no clip offset');
assert.equal(by['msnbc'].sourceStatus, 'upstream_error');
assert.equal(by['msnbc'].sourceError, 'advancedsearch HTTP 503');
assert.equal(by['bbc'].programs.length, 0);

setCableNewsFetchForTests(undefined);
console.log('cable news guide regression: all passed');
