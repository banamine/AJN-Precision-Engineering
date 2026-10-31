// Offline regression: Search -> "Create 24/7 Channel" builds TV News recordings as
// clips (whole files are private), keeps the given order, and the channel is
// readable by the player's auto-advance under guide 'discovery'.
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
const D = await import('./server/discoveryChannels.ts');
const metas: Record<string, any> = {
  FOXNEWSW_20150331_080000_The_Kelly_File: { metadata: { title: 'The Kelly File', collection: ['TV-FOXNEWSW', 'tvarchive'] },
    files: [{ name: 'FOXNEWSW_20150331_080000_The_Kelly_File.mp4', length: '3660', private: 'true' }] },
  FOXNEWSW_20260927_220000_One_Nation: { metadata: { title: 'One Nation' }, files: [{ name: 'x.json' }] },  // still processing
  some_film: { metadata: { title: 'A Film', mediatype: 'movies' }, files: [{ name: 'f.mp4', format: 'h.264', length: '600' }] },
};
D.setDiscoveryFetchForTests((async (u: string) => {
  const id = decodeURIComponent(String(u).split('/metadata/')[1]);
  return metas[id] ? new Response(JSON.stringify(metas[id])) : new Response('', { status: 404 });
}) as any);
const ch = await D.buildDiscoveryChannel(['FOXNEWSW_20150331_080000_The_Kelly_File', 'FOXNEWSW_20260927_220000_One_Nation', 'some_film', 'bad id!'], 'Fox News 24/7', 'FOXNEWSW');
assert.equal(ch.id, 'discovery-foxnewsw-fox-news-24-7');
const kelly = ch.programs.filter((p) => p.id.startsWith('disc-FOXNEWSW_20150331'));
assert.equal(kelly.length, 13, '3660 s -> 13 clips of <= 282 s');
assert.equal(kelly[0].archivePath, '/download/FOXNEWSW_20150331_080000_The_Kelly_File/FOXNEWSW_20150331_080000_The_Kelly_File.mp4?exact=1&start=0&end=282');
assert.ok(!ch.programs.some((p) => /\.mp4$/.test(p.archivePath!) && p.id.startsWith('disc-FOXNEWSW')), 'never the private whole file');
assert.equal(ch.programs.at(-1)!.archivePath, '/download/some_film/f.mp4');
assert.deepEqual(ch.skipped.map((s) => s.reason), ['recording not published yet (no MP4)']);

const { getScheduleForGuide } = await import('./guideRegistry.ts');
const g = await getScheduleForGuide('discovery');
const row = g.find((c) => c.id === ch.id)!;
assert.ok(row && row.programs.length >= 14, 'channel readable by the player under guide discovery');
assert.ok(row.programs[0].mediaUrl.startsWith('/api/archive/proxy?path='), 'served through the proxy like every guide');

await assert.rejects(D.buildDiscoveryChannel(['nope'], 'x'), /none of the 1 items/);
await assert.rejects(D.buildDiscoveryChannel(['bad id!'], 'x'), /no valid Archive identifiers/);
console.log('discovery channel regression: all passed');
process.exit(0);
