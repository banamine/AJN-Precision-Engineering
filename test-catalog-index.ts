import assert from 'node:assert/strict';
import { queryCatalog, catalogStats } from './server/catalogIndex';

const st = await catalogStats();
assert.ok(st.total > 4000 && st.byStatus.playable > 3000, 'snapshot loaded');
const all = await queryCatalog({ status: 'all', limit: 100 });
assert.equal(all.totalItems, st.total, 'status=all returns everything');
const def = await queryCatalog({});
assert.equal(def.totalItems, st.byStatus.playable, 'default is playable only');
assert.ok(def.items.every((i) => i.status === 'playable' && i.selected?.path), 'playable rows carry a file path');
// genre chip counts equal list counts
for (const g of def.genres.slice(0, 5)) assert.equal((await queryCatalog({ genre: g.genre, limit: 1 })).totalItems, g.count, `chip ${g.genre} == list`);
// search is AND over tokens and accent/case-insensitive
const a = await queryCatalog({ q: 'chaplin' }); const b = await queryCatalog({ q: 'CHAPLIN' });
assert.equal(a.totalItems, b.totalItems);
const two = await queryCatalog({ q: 'chaplin zzzznotathing' }); assert.equal(two.totalItems, 0);
// pagination reconciles
const seen = new Set<string>(); let pg = 1, tp = 1;
do { const r = await queryCatalog({ limit: 100, page: pg }); tp = r.totalPages; r.items.forEach((i) => seen.add(i.id)); pg++; } while (pg <= tp);
assert.equal(seen.size, def.totalItems, 'pages cover every row once');
// rules held in the snapshot
assert.ok(all.items.every((i) => !/[Ѐ-ӿ]/.test(i.displayTitle)), 'no Cyrillic in labels');
const col = { items: [...(await queryCatalog({ status: 'collection', limit: 100, page: 1 })).items, ...(await queryCatalog({ status: 'collection', limit: 100, page: 2 })).items] };
const known = col.items.filter((i: any) => i.expanded !== undefined);
assert.ok(known.length === 117 && known.every((i: any) => typeof i.expanded === 'boolean' && typeof i.memberCount === 'number'), 'favorited collections report expanded + member count');
console.log('catalog index: ok');
