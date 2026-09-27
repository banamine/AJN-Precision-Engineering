// Offline regression: versioned Library Favorites store (v0 array -> v1 object).
import assert from 'node:assert/strict';
import { parseFavorites, serializeFavorites, loadFavorites, saveFavorites, FAVORITES_STORAGE_KEY } from './src/utils/favoritesStore.ts';

assert.deepEqual(parseFavorites('["a","b","a",3]'), ['a', 'b'], 'v0 plain array migrates, deduped, strings only');
assert.deepEqual(parseFavorites('{"version":1,"ids":["x"]}'), ['x']);
assert.deepEqual(parseFavorites('{"version":9,"ids":["x"]}'), [], 'unknown future version ignored, not crashed');
assert.deepEqual(parseFavorites('not json'), []);
assert.deepEqual(parseFavorites(null), []);
assert.deepEqual(JSON.parse(serializeFavorites(['a', 'a', 'b'])), { version: 1, ids: ['a', 'b'] });

const mem = new Map<string, string>();
const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
mem.set(FAVORITES_STORAGE_KEY, '["old-1"]');
assert.deepEqual([...loadFavorites(store)], ['old-1']);
assert.equal(saveFavorites(['old-1', 'new-2'], store), true);
assert.deepEqual(JSON.parse(mem.get(FAVORITES_STORAGE_KEY)!), { version: 1, ids: ['old-1', 'new-2'] });
const full = { setItem: () => { throw new Error('QuotaExceededError'); } };
assert.equal(saveFavorites(['a'], full), false, 'quota failure reported, not thrown');
console.log('favorites store regression: all passed');
