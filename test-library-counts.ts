// Regression: Library button counts must equal what the list returns (grouped unit), "All" counts each item once,
// genre + search + decade combine as AND, pages add up, and Chaplin shorts stay under Silent Films (not hidden, not Classic TV).
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
const L = await import('./server/libraryIndex.ts');
await L.loadLibrarySnapshot();

const hm = L.libraryHeatmap();
assert.ok(hm.categories.some((c) => c.total > 0), 'snapshot loaded');
for (const c of hm.categories) {
  const r = L.queryLibrary({ category: c.categoryId, limit: 48 });
  assert.equal(c.total, r.totalItems, `${c.categoryId}: button count == list count`);
  assert.equal(c.rawTotal, r.rawCount, `${c.categoryId}: rawTotal == raw records`);
  for (const d of c.decades) assert.equal(d.count, L.queryLibrary({ category: c.categoryId, decade: d.decade, limit: 48 }).totalItems, `${c.categoryId} ${d.decade}s: decade count == list count`);
  assert.equal(c.decades.reduce((n, d) => n + d.count, 0) >= c.total, true, `${c.categoryId}: decade counts never below total`);
  // pagination: every page together returns exactly totalItems, no repeats
  const seen = new Set<string>();
  for (let p = 1; p <= r.totalPages; p++) for (const i of L.queryLibrary({ category: c.categoryId, limit: 48, page: p }).items) seen.add((i as any).id);
  assert.equal(seen.size, r.totalItems, `${c.categoryId}: pages add up to total`);
}
const all = L.queryLibrary({ limit: 48 });
assert.equal(hm.allTotal, all.totalItems, 'All count == unfiltered list count');
assert.equal(hm.allRawTotal, all.rawCount);
const sumChips = hm.categories.reduce((n, c) => n + c.total, 0);
assert.ok(sumChips >= hm.allTotal, 'summing chips can only over-count (items in two genres); All must not use that sum');

// Genre + search are ANDed; Chaplin is legitimate Silent Films content.
const sf = L.queryLibrary({ category: 'silent-films', q: 'chaplin', limit: 48 });
assert.ok(sf.totalItems > 0, 'Chaplin shorts are present under Silent Films');
assert.ok(sf.items.every((i: any) => /chaplin/i.test(`${i.title} ${i.description ?? ''} ${i.identifier}`)), 'search narrows within the genre');
assert.equal(L.queryLibrary({ category: 'classic-tv', q: 'chaplin' }).totalItems, 0, 'Chaplin is not in Classic TV');
assert.ok(L.queryLibrary({ q: 'chaplin', limit: 48 }).totalItems >= sf.totalItems, 'All-genre search finds at least the genre hits');
console.log('library counts: ok');
