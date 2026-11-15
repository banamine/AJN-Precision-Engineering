import assert from 'node:assert/strict';
import { catalogRecords, isCatalogRecord, CATALOG_CATEGORY_IDS } from './server/library/catalogRecords';
import { queryLibrary, setLibraryIndexForTests, needsProbe } from './server/libraryIndex';

const recs = catalogRecords();
const by = (c: string) => recs.filter((r) => r.categoryIds.includes(c));
assert.equal(by('concerts').length, 1410, 'every manifest concert');
assert.equal(by('fm-broadcasts').length, 346, 'every FM broadcast');
assert.equal(by('podcast-episodes').length, 36, 'every archived podcast episode');
assert.equal(new Set(recs.map((r) => r.id)).size, recs.length, 'unique ids');
for (const r of recs) {
  assert.ok(r.path.startsWith('/download/') && r.parts && r.parts.length > 0 && r.mediaType === 'audio', r.id);
  assert.equal(r.availability, 'unverified', 'never claimed verified');
  assert.ok(isCatalogRecord(r) && !needsProbe(r), 'catalog records are not probed');
}
assert.ok(CATALOG_CATEGORY_IDS.length === 3);

setLibraryIndexForTests([]);
const ids = (q: string, genre?: string) => queryLibrary({ q, limit: 48 } as never).items.map((i: any) => i.id);
const total = (q: string) => (queryLibrary({ q, limit: 48 } as never) as any).totalItems as number;
assert.ok(total('jazz') > 100, 'jazz finds concerts');
assert.ok(ids('jazz').some((id: string) => id.startsWith('concert:')));
assert.ok(total('fm') > 0 && total('podcast') > 0);
assert.ok(total('country') > 0);
console.log('catalog feed ok', recs.length, 'jazz', total('jazz'), 'fm', total('fm'), 'podcast', total('podcast'), 'country', total('country'));
