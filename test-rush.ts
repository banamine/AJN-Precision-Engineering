// Offline regression: Rush JIT resolver — cache miss hits Archive once, then cache.
import assert from 'node:assert/strict';
process.env.RUSH_CACHE_FILE = '/tmp/ajn-test-rush-cache.json';
const { resolveRushItem, setRushFetchForTests, rushStats } = await import('./server/rush.ts');
let calls = 0;
setRushFetchForTests((async () => { calls++; return new Response(JSON.stringify({ files: [
  { name: 'hour-2.mp3', source: 'original', length: '3510.2', format: 'VBR MP3' },
  { name: 'hour-1.mp3', source: 'original', length: '58:02', format: 'VBR MP3' },
  { name: 'hour-1_64kb.mp3', source: 'derivative', length: '3482' },
  { name: 'cover.jpg', source: 'original' },
] }), { status: 200 }); }) as typeof fetch);
const a = await resolveRushItem('rush-x-2005-06-03');
assert.equal(a.source, 'archive');
assert.deepEqual(a.tracks.map((t) => t.file), ['hour-1.mp3', 'hour-2.mp3'], 'originals only, in order');
assert.equal(a.tracks[0].durationSeconds, 3482);
assert.ok(a.tracks[0].mediaUrl.startsWith('/api/archive/proxy?path=%2Fdownload%2Frush-x-2005-06-03%2Fhour-1.mp3'));
const b = await resolveRushItem('rush-x-2005-06-03');
assert.equal(b.source, 'cache');
assert.equal(calls, 1, 'second request is a cache hit');
assert.equal(rushStats.cacheHits, 1);

// Morning Update derivatives are preferred, but verified original MPEG4 files
// remain playable when Archive has not made an .ia.mp4 derivative.
const morningUpdateId = 'rush-limbaugh-radio-show-morning-update-2016-12-29';
const originalMpeg4 = {
  name: 'Rush Limbaugh - Dec 29 2016 - Morning Update.mp4',
  source: 'original',
  format: 'MPEG4',
  length: '95.53',
  size: '7088326',
};
const iaVideo = {
  name: 'rush-morning-update.ia.mp4',
  source: 'derivative',
  format: 'h.264 IA',
  length: '95.53',
  size: '1400000',
};
setRushFetchForTests((async () => {
  return new Response(JSON.stringify({ files: [originalMpeg4, iaVideo] }), { status: 200 });
}) as typeof fetch);
const preferredVideo = await resolveRushItem(morningUpdateId);
assert.equal(preferredVideo.tracks[0].file, 'rush-morning-update.ia.mp4');
assert.equal(preferredVideo.tracks[0].kind, 'video');
assert.equal(preferredVideo.tracks[0].role, 'morning-update');

setRushFetchForTests((async () => {
  return new Response(JSON.stringify({ files: [originalMpeg4] }), { status: 200 });
}) as typeof fetch);
const originalVideo = await resolveRushItem(morningUpdateId);
assert.equal(originalVideo.tracks[0].file, originalMpeg4.name);
assert.equal(originalVideo.tracks[0].format, 'MPEG4');
assert.equal(originalVideo.tracks[0].kind, 'video');
assert.equal(originalVideo.tracks[0].role, 'morning-update');

setRushFetchForTests((async () => {
  return new Response(JSON.stringify({ files: [{ ...originalMpeg4, format: 'unknown' }] }), { status: 200 });
}) as typeof fetch);
await assert.rejects(resolveRushItem(morningUpdateId), /no compatible Morning Update MP4/);
console.log('rush resolver regression: all passed');
process.exit(0);
