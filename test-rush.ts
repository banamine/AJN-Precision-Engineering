// Offline regression: Rush JIT resolver — cache miss hits Archive once, then cache.
import assert from 'node:assert/strict';
process.env.RUSH_CACHE_FILE = '/tmp/ajn-test-rush-cache.json';
const { resolveRushDay, resolveRushItem, filesFromMetadata, morningUpdateFilesFromMetadata, setRushFetchForTests, rushStats } = await import('./server/rush.ts');
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

const iaId = 'rush-limbaugh-radio-show-morning-update-2005-12-19';
const iaFiles = morningUpdateFilesFromMetadata({ files: [
  { name: 'Rush Limbaugh - Dec 19 2005 - Morning Update.mp4', source: 'original', length: '90.65', format: 'MPEG4' },
  { name: 'Rush Limbaugh - Dec 19 2005 - Morning Update.ia.mp4', source: 'derivative', length: '90.67', format: 'h.264 IA' },
] }, iaId);
assert.deepEqual(iaFiles.map((file) => file.file), ['Rush Limbaugh - Dec 19 2005 - Morning Update.ia.mp4'], 'verified H.264 IA derivative wins');

const originalId = 'rush-limbaugh-radio-show-morning-update-2014-07-04';
const originalFiles = morningUpdateFilesFromMetadata({ files: [
  { name: 'Rush Limbaugh - Jul 04 2014 - Morning Update.mp4', source: 'original', length: '94.64', format: 'MPEG4' },
] }, originalId);
assert.equal(originalFiles[0]?.file, 'Rush Limbaugh - Jul 04 2014 - Morning Update.mp4', 'verified original H.264/AAC MP4 is allowed');
assert.deepEqual(morningUpdateFilesFromMetadata({ files: [
  { name: 'unknown.mp4', source: 'original', length: '90', format: 'MPEG4' },
] }, 'rush-limbaugh-radio-show-morning-update-unverified'), [], 'unknown original codec is unavailable, not guessed');

const dayEntries = [
  { id: iaId, date: '2005-12-19', year: 2005, role: 'morning-update' as const },
  { id: 'rush-limbaugh-radio-show-2005-12-19', date: '2005-12-19', year: 2005, role: 'full-show' as const },
];
const mixedAvailable = await resolveRushDay(dayEntries, async (id, role) => role === 'morning-update'
  ? { id, role, kind: 'video', source: 'archive', resolvedAt: 'test', tracks: [{
      file: 'morning.ia.mp4', durationSeconds: 90, archivePath: '/download/morning.ia.mp4', mediaUrl: '/api/archive/proxy?path=%2Fdownload%2Fmorning.ia.mp4',
    }] }
  : { id, role, kind: 'audio', source: 'cache', resolvedAt: 'test', tracks: [{
      file: 'hour-1.mp3', durationSeconds: 3600, archivePath: '/download/show/hour-1.mp3', mediaUrl: '/api/archive/proxy?path=%2Fdownload%2Fshow%2Fhour-1.mp3',
    }] });
assert.deepEqual(mixedAvailable.map((item) => item.kind), ['video', 'audio'], 'a paired date keeps its separate media kinds');

const mixed = await resolveRushDay(dayEntries, async (id, role) => role === 'morning-update'
  ? { id, role, kind: 'video', unavailable: { reason: 'codec not verified' } }
  : { id, role, kind: 'audio', source: 'cache', resolvedAt: 'test', tracks: [{
      file: 'hour-1.mp3', durationSeconds: 3600, archivePath: '/download/show/hour-1.mp3', mediaUrl: '/api/archive/proxy?path=%2Fdownload%2Fshow%2Fhour-1.mp3',
    }] });
assert.equal(mixed.length, 2);
assert.equal(mixed[0].role, 'morning-update');
assert.equal('unavailable' in mixed[0] && mixed[0].unavailable.reason, 'codec not verified');
assert.equal(mixed[1].role, 'full-show');
assert.equal('tracks' in mixed[1] && mixed[1].kind, 'audio');
await assert.rejects(() => resolveRushDay(dayEntries, async (id, role) => {
  if (role === 'full-show') throw Object.assign(new Error('full show failed'), { status: 503 });
  return { id, role, kind: 'video', unavailable: { reason: 'unavailable' } };
}), /full show failed/, 'a failed Full Show remains a date-level failure');

assert.deepEqual(filesFromMetadata({ files: [{ name: 'rush-1.mp3', source: 'original', length: '42', format: 'VBR MP3' }] }).map((f) => f.file), ['rush-1.mp3']);
console.log('rush resolver regression: all passed');
process.exit(0);
