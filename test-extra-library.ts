// Offline: extra library records are search-only, well-formed, and fold into series.
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
const { extraLibraryRecords } = await import('./server/library/extraLibraryRecords.ts');
const { groupLibraryResults } = await import('./server/library/series.ts');
const L = await import('./server/libraryIndex.ts');
const recs = extraLibraryRecords();
assert.equal(recs.length, 392, 'all 392 rows');
assert.equal(new Set(recs.map((r) => r.id)).size, 392, 'unique ids');
for (const r of recs) {
  assert.ok(r.path.startsWith('/download/') && r.dur > 0 && r.mediaType === 'video', r.id);
  assert.ok(!r.guideId && !r.channelId && !r.programId, `${r.id} must not be a guide/channel record`);
}
assert.equal(recs.filter((r) => r.showLabel === 'Green Acres').length, 78);
const g = groupLibraryResults(recs.map((r) => ({ ...r, type: 'item' as const })) as any);
const ga = (g as any[]).find((x) => x.type === 'series' && /green acres/i.test(x.title));
assert.ok(ga && ga.episodeCount === 78, 'Green Acres folds into one 78-episode series');
assert.ok((g as any[]).find((x) => x.type === 'series' && /victory at sea/i.test(x.title))?.episodeCount === 4);
L.setLibraryIndexForTests([]); L.setExtraLibraryForTests(true);
const q = L.queryLibrary({ q: 'green acres', limit: 48, page: 1 }) as any;
assert.ok(q.items.some((i: any) => i.type === 'series' && /green acres/i.test(i.title) && i.episodeCount === 78), 'search finds Green Acres as one 78-episode series');
const m = L.queryLibrary({ q: 'drums of jeopardy', limit: 48, page: 1 }) as any;
assert.ok(m.items.some((i: any) => /drums of jeopardy/i.test(i.title)), 'a single film is searchable');
L.setLibraryIndexForTests([]);
assert.equal((L.queryLibrary({ q: 'green acres', limit: 48, page: 1 }) as any).items.length, 0, 'fixture tests do not see the extra records');
console.log('test-extra-library OK', recs.length, 'records;', (g as any[]).filter((x) => x.type === 'series').length, 'series');
