// Offline regression: shared media selector + Library index (records, merge, paging, decades,
// guide categories, 2-strike file check, search top-up through the limiter seam).
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
const S = await import('./server/archive/mediaSelector.ts');
const L = await import('./server/libraryIndex.ts');

// Selector
const files = [
  { name: 'film.mpeg', format: 'MPEG2' },
  { name: 'film_512kb.mp4', format: '512Kb MPEG4', length: '600' },
  { name: 'film #1.mp4', format: 'h.264', length: '30:00' },
  { name: 'hidden.mp4', format: 'h.264', private: 'true' },
  { name: 'film.mp4', format: 'MPEG4 Master' },
];
const v = S.selectPlayableFile('my item', files, undefined, 'video');
assert.equal(v.filename, 'film #1.mp4', 'h.264 beats 512Kb; private and masters skipped');
assert.equal(v.canonicalPath, '/download/my%20item/film%20%231.mp4', 'both parts URL-encoded');
assert.equal(v.durationSeconds, 1800); assert.equal(v.durationSource, 'file-length'); assert.equal(v.availability, 'unverified');
const a = S.selectPlayableFile('otr', [{ name: 'ep1.ogg', format: 'Ogg Vorbis' }, { name: 'ep1_64kb.mp3', format: '64Kbps MP3' }, { name: 'ep1.mp3', format: 'VBR MP3' }], '00:29:30', 'audio');
assert.equal(a.filename, 'ep1.mp3'); assert.equal(a.durationSource, 'item-runtime'); assert.equal(a.durationSeconds, 1770);
const d = S.selectPlayableFile('x', [{ name: 'a.mp4', format: 'h.264' }], undefined, 'video');
assert.equal(d.durationSource, 'default'); assert.equal(d.durationEstimated, true);
assert.equal(S.selectPlayableFile('x', [{ name: 'a.avi', format: 'Cinepack' }], undefined, 'video').availability, 'unsupported');
assert.equal(S.selectPlayableFile('x', null, undefined, 'audio').availability, 'unsupported');

// Records + merge
const cartoons = L.LIBRARY_CATEGORIES.find((c) => c.id === 'cartoons')!;
const cinema = L.LIBRARY_CATEGORIES.find((c) => c.id === 'classic-cinema')!;
const meta = (y: string) => ({ metadata: { date: y }, files: [{ name: 'a.mp4', format: 'h.264', length: '420' }] });
const r1 = L.recordFromMetadata(cartoons, { identifier: 'popeye1', title: 'Popeye', year: '1936' }, meta('1936'));
assert.equal(r1.id, 'ia-popeye1'); assert.equal(r1.decade, 1930); assert.equal(r1.path, '/download/popeye1/a.mp4');
const r1b = L.recordFromMetadata(cinema, { identifier: 'popeye1', title: 'Popeye' }, meta('1936'));
const merged = L.mergeRecords([r1, r1b]);
assert.equal(merged.length, 1); assert.deepEqual(merged[0].categoryIds, ['cartoons', 'classic-cinema']);

// Index queries
const recs = [r1, r1b,
  L.recordFromMetadata(cartoons, { identifier: 'betty', title: 'Betty Boop', date: '1932-05-01' }, meta('1932')),
  L.recordFromMetadata(cartoons, { identifier: 'undated', title: 'Mystery Reel' }, { files: [{ name: 'm.mp4', format: 'h.264' }] }),
  ...Array.from({ length: 30 }, (_, i) => L.recordFromMetadata(cinema, { identifier: `film${i}`, title: `Film ${String(i).padStart(2, '0')}`, year: String(1950 + i) }, meta(String(1950 + i)))),
];
L.setLibraryIndexForTests(L.mergeRecords(recs));
let q = L.queryLibrary({ category: 'cartoons', page: 1, limit: 24 });
assert.deepEqual(q.items.map((i) => i.title), ['Betty Boop', 'Popeye', 'Mystery Reel'], 'oldest first, undated last');
assert.ok(q.items.every((i) => i.playbackMode === 'vod'));
q = L.queryLibrary({ category: 'classic-cinema', limit: 24, page: 2 });
assert.equal(q.totalItems, 31); assert.equal(q.totalPages, 2); assert.equal(q.items.length, 7);
assert.equal(L.queryLibrary({ limit: 500 }).limit, 48, 'page size capped');
assert.deepEqual(L.queryLibrary({ category: 'cartoons', decade: 0 }).items.map((i) => i.title), ['Mystery Reel'], 'decade 0 = undated');
assert.equal(L.queryLibrary({ category: 'classic-cinema', decade: 1960 }).totalItems, 10);
assert.equal(L.queryLibrary({ q: 'betty' }).totalItems, 1);
assert.deepEqual(L.queryLibrary({ ids: ['ia-popeye1', 'nope'] }).items.map((i) => i.id), ['ia-popeye1']);
const hm = L.libraryHeatmap().categories.find((c) => c.categoryId === 'cartoons')!;
assert.equal(hm.total, 3); assert.deepEqual(hm.decades, [{ decade: 1930, count: 2 }, { decade: 0, count: 1 }]);

// Guide category: records from an existing guide; repeats and live streams skipped; last good kept.
const aero = L.LIBRARY_CATEGORIES.find((c) => c.id === 'aerospace')!;
const guide: any[] = [{ id: 'nasa-missions', name: 'NASA', programs: [
  { id: 'nasa-a:d0', title: 'Apollo 11', mediaType: 'video', archivePath: '/download/a/a.mp4', metadata: { durationSeconds: 900, year: '1969', identifier: 'a' } },
  { id: 'nasa-a:d5', title: 'Apollo 11', mediaType: 'video', archivePath: '/download/a/a.mp4', metadata: { durationSeconds: 900 } },
] }, { id: 'doc-x', name: 'Docs', programs: [{ id: 'd', title: 'Doc', archivePath: '/download/d/d.mp4', metadata: {} }] }];
const g = L.recordsFromGuide(aero, guide);
assert.equal(g.length, 1); assert.equal(g[0].id, 'nasa-a'); assert.equal(g[0].decade, 1960); assert.equal(g[0].channelId, 'nasa-missions');
L.setGuideRecords('aerospace', g);
L.setGuideRecords('aerospace', []);
assert.equal(L.queryLibrary({ category: 'aerospace' }).totalItems, 1, 'empty guide refresh keeps last good');

// File check: 206 -> verified; one 404 keeps it; two 404s hide it; network error no verdict.
let status = 206;
L.setLibraryProbeFetchForTests((async (u: URL) => {
  assert.equal(String(u).startsWith('https://archive.org/download/'), true);
  if (status === 0) throw new TypeError('fetch failed');
  return new Response('ab', { status, headers: { 'content-type': 'video/mp4' } });
}) as any);
const target = L.queryLibrary({ ids: ['ia-betty'] }).items[0];
assert.equal(await L.probeRecord(target), 'verified');
status = 404; assert.equal(await L.probeRecord(target), 'verified', 'one failure is not enough');
status = 0; await L.probeRecord(target);
status = 404; assert.equal(await L.probeRecord(target), 'unavailable');
assert.equal(L.queryLibrary({ ids: ['ia-betty'] }).totalItems, 0, 'unavailable items hidden');

// Top-up: new identifiers inspected (bounded), known ones join the category.
L.setLibraryMetaFetchForTests((async (u: string) => {
  const s = String(u);
  if (s.includes('advancedsearch')) { assert.ok(s.includes('sort%5B%5D') || s.includes('sort[]=downloads')); return new Response(JSON.stringify({ response: { docs: [{ identifier: 'popeye1' }, { identifier: 'new1', title: 'New One', year: '1941' }, { identifier: 'new2', title: 'Two' }] } })); }
  if (s.endsWith('/new2')) return new Response('', { status: 500 });
  return new Response(JSON.stringify(meta('1941')));
}) as any);
const scifi = L.LIBRARY_CATEGORIES.find((c) => c.id === 'scifi-horror')!;
assert.equal(await L.topUpCategory(scifi, 5), 1);
assert.ok(L.queryLibrary({ ids: ['ia-popeye1'] }).items[0].categoryIds.includes('scifi-horror'));
assert.equal(L.queryLibrary({ category: 'scifi-horror' }).totalItems, 2);
console.log('library index regression: all passed');
process.exit(0);
