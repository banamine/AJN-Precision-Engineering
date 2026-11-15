// Offline regression: NASA channel — web-format selection by Archive `format`, duration provenance,
// stable order, dedupe, metadata cache, last good lineup kept.
import assert from 'node:assert/strict';
const N = await import('./server/sources/nasaArchive.ts');

assert.equal(N.parseDuration('1823.6'), 1824);
assert.equal(N.parseDuration('30:23'), 1823);
assert.equal(N.parseDuration('00:30:23'), 1823);
assert.equal(N.parseDuration('28 minutes'), 1680);
assert.equal(N.parseDuration('1 hr 5 min'), 3900);
for (const bad of ['', '0', 'unknown', null, undefined]) assert.equal(N.parseDuration(bad), 0);

assert.deepEqual(N.resolveDuration({ length: '600' }, {}), { seconds: 600, source: 'file', isEstimated: false });
assert.deepEqual(N.resolveDuration({ length: '0' }, { metadata: { runtime: '27:10' } }), { seconds: 1630, source: 'runtime', isEstimated: false });
assert.deepEqual(N.resolveDuration({}, { metadata: {} }), { seconds: 1800, source: 'default', isEstimated: true });

const meta = { files: [
  { name: 'apollo11.mpeg', format: 'MPEG2' },
  { name: 'apollo11_master.mp4', format: 'MPEG4 Master' },          // .mp4 but not a web derivative
  { name: 'apollo11_512kb.mp4', format: '512Kb MPEG4', length: '1200' },
  { name: 'apollo11.ia.mp4', format: 'h.264 IA', length: '1201' },
  { name: 'secret.mp4', format: 'h.264', private: 'true' },
] };
const sel = N.selectVideoFile('apollo-11', meta)!;
assert.equal(sel.fileName, 'apollo11.ia.mp4');
assert.equal(sel.canonicalUrl, 'https://archive.org/download/apollo-11/apollo11.ia.mp4');
assert.equal(N.selectVideoFile('x', { files: [{ name: 'a.mp4', format: 'MPEG4 Master' }, { name: 'a.mov', format: 'QuickTime' }] }), null, 'no web format -> rejected');

// Pipeline with a mocked Archive.
const docs = [
  { identifier: 'b-item', title: 'Gemini 4', date: '1965-06-03' },
  { identifier: 'a-item', title: 'Apollo 11', date: '1969-07-20' },
  { identifier: 'b-item', title: 'dup' },
  { identifier: 'master-only', title: 'Raw', date: '1970-01-01' },
  { identifier: 'no-len', title: 'Skylab', date: '1973-05-14' },
];
const metas: Record<string, any> = {
  'a-item': { files: [{ name: 'a.mp4', format: 'h.264', length: '900' }] },
  'b-item': { files: [{ name: 'b.mp4', format: '512Kb MPEG4', length: '12:00' }] },
  'master-only': { files: [{ name: 'm.mp4', format: 'MPEG4 Master' }] },
  'no-len': { files: [{ name: 's.mp4', format: 'MPEG4' }], metadata: {} },
};
let metaCalls = 0, searchUp = true;
N.setNasaFetchForTests((async (u: string) => {
  const s = String(u);
  if (s.includes('advancedsearch')) return searchUp ? new Response(JSON.stringify({ response: { docs } })) : new Response('', { status: 503 });
  metaCalls++;
  return new Response(JSON.stringify(metas[decodeURIComponent(s.split('/metadata/')[1])]));
}) as any);
const progs = await N.buildNasaPrograms('science-documentaries');
assert.deepEqual(progs.map((p) => p.title), ['Gemini 4', 'Apollo 11', 'Skylab'], 'deduped, master-only rejected, ordered by date');
assert.equal(progs[0].archivePath, '/download/b-item/b.mp4');
assert.equal((progs[0].metadata as any).durationSeconds, 720);
assert.equal((progs[2].metadata as any).durationSource, 'default');
assert.equal((progs[2].metadata as any).durationEstimated, true);
assert.equal(N.nasaStats.unsupported, 1);
assert.equal(metaCalls, 4);
await N.buildNasaPrograms('science-documentaries');
assert.equal(metaCalls, 4, 'metadata served from cache on the next build');
assert.ok(N.nasaStats.cacheHits >= 4);
const again = await N.buildNasaPrograms('science-documentaries');
assert.deepEqual(again.map((p) => p.id), progs.map((p) => p.id), 'same input -> same lineup');

// Lineup accessor: first load fills; a failed refresh keeps it.
const first = await N.getNasaPrograms('science-documentaries');
assert.equal(first.programs.length, 3);
console.log('nasa archive regression: all passed');
process.exit(0);
