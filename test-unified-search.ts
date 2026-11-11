import assert from 'node:assert/strict';
import { resolveGenres, genresByPrefix, inGenrePools, GENRE_THESAURUS } from './src/search/genreThesaurus';
import { readSharedQuery, writeSharedQuery, SHARED_SEARCH_KEY } from './src/hooks/useSharedSearch';
import { queryLibrary, setLibraryIndexForTests, type IndexRecord } from './server/libraryIndex';
import { matchesQuery } from './src/search/normalize';

// thesaurus
assert.deepEqual(resolveGenres('Classic Movies').map((g) => g.id), ['classic-movies']);
assert.deepEqual(resolveGenres('old  movies').map((g) => g.id), ['classic-movies']);
assert.deepEqual(resolveGenres('B&W').map((g) => g.id), ['classic-movies']);
assert.deepEqual(resolveGenres('sitcom').map((g) => g.id).sort(), ['comedy', 'tv']);
assert.deepEqual(resolveGenres('zzz'), []);
assert.deepEqual(genresByPrefix('cl').length, 0, 'prefix needs 3 chars');
assert.ok(genresByPrefix('class').some((g) => g.id === 'classic-movies'));
assert.ok(GENRE_THESAURUS.every((g) => g.aliases.length > 0 && (g.categoryIds.length > 0 || g.terms.length > 0)), 'every genre has a real pool');
assert.ok(inGenrePools(resolveGenres('tv'), { categoryIds: ['classic-tv'] }, () => false));
assert.ok(!inGenrePools(resolveGenres('tv'), { categoryIds: ['apollo'] }, () => false));

// shared query storage (injectable)
const mem = new Map<string, string>(); const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
writeSharedQuery('star trek', st); assert.equal(mem.get(SHARED_SEARCH_KEY), 'star trek'); assert.equal(readSharedQuery(st), 'star trek');
writeSharedQuery('', st); assert.equal(readSharedQuery(st), '');
assert.equal(readSharedQuery(undefined as any), '', 'no storage -> empty');

// server: genre words match whole pools, titles still match
const rec = (id: string, title: string, categoryIds: string[]): IndexRecord => ({ id, identifier: id, title, categoryIds, mediaType: 'video', availability: 'available', path: `/x/${id}.mp4`, format: 'mp4', dur: 100, durSrc: 'x', durEst: false } as unknown as IndexRecord);
setLibraryIndexForTests([
  rec('a', 'The Maltese Falcon', ['classic-cinema']), rec('b', 'Night of the Living Dead', ['scifi-horror']),
  rec('c', 'Hogans Heroes S01', ['classic-tv']), rec('d', 'The Glass Key (Colorized)', ['movie-vault']),
  rec('e', 'Gunsmoke Ep 1', ['educational']), rec('f', 'Apollo 11 Highlights', ['apollo']),
]);
const ids = (q: string) => queryLibrary({ q, limit: 48 }).items.map((i: any) => i.title).sort();
assert.deepEqual(ids('classic movies'), ['The Glass Key (Colorized)', 'The Maltese Falcon'], 'pool by category');
assert.deepEqual(ids('tv'), ['Hogans Heroes S01'], 'tv pool');
assert.deepEqual(ids('colorized'), ['The Glass Key (Colorized)'], 'term-only pool');
assert.deepEqual(ids('westerns'), ['Gunsmoke Ep 1'], 'western terms');
assert.deepEqual(ids('space'), ['Apollo 11 Highlights', 'Night of the Living Dead'], 'sci-fi pool = scifi-horror + apollo');
assert.deepEqual(ids('maltese'), ['The Maltese Falcon'], 'plain title match unchanged');
assert.deepEqual(ids('dance'), [], 'no pool and no title -> honest empty');
assert.ok(matchesQuery(['Hogans Heroes'], 'hogan'));
console.log('unified-search ok');
