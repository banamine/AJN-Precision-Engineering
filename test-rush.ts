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
console.log('rush resolver regression: all passed');
process.exit(0);
