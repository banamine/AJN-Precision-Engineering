// Run: npx tsx server/onairArchive.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import lib from '../src/data/usgovLibrary.json' with { type: 'json' };
import { buildOnThisDay, chunkQueryUrl, cleanTitle, dayOfYearOk, denverMMDD, isPlaceholderDate, selectItems, sentenceCase, toCandidate, YEARS_PER_QUERY, type ArchiveItem } from './onairArchive.ts';

const collections = lib.collections;
const libById = new Map(collections.map((c) => [c.identifier, c]));
const doc = (o: Record<string, unknown> = {}) => ({ identifier: 'x1', title: 'A real caption here', date: '1963-11-22T00:00:00Z', collection: ['ciareadingroom', 'usgovernmentmirrors', 'government-documents'], mediatype: 'texts', downloads: 5, ...o });
const item = (o: Partial<ArchiveItem>): ArchiveItem => ({ identifier: 'i', title: 't', collection: 'c', collectionName: 'C', date: '1960-11-22', year: 1960, mediatype: 'texts', downloads: 1, thumbnail: '', url: '', ...o });
const reply = (docs: unknown[], status = 200) => ({ status, ok: status < 400, json: async () => ({ response: { docs } }) }) as unknown as Response;

test('library data: 63 collections', () => assert.equal(collections.length, 63));
test('cleanTitle strips prefixes, sentence-cases, keeps acronyms, drops id-only', () => {
  assert.equal(cleanTitle('CIA Reading Room cia-rdp99-00498r000100010063-4: U.S. ASSASSINATION PLOTS'), 'U.S. assassination plots');
  assert.equal(cleanTitle('NASA Technical Reports Server (NTRS) 20110023495: Packaging material'), 'Packaging material');
  assert.equal(cleanTitle('DTIC ADA062766: Breadboard Dropsonde. Volume II.'), 'Breadboard Dropsonde. Volume II.');
  assert.equal(cleanTitle('KISSINGER TRUSTS CIA-NSA LINK'), 'Kissinger trusts CIA-NSA link');
  assert.equal(cleanTitle('ONE THING HAPPENED. THEN ANOTHER'), 'One thing happened. Then another');
  assert.equal(cleanTitle('CIA Reading Room cia-rdp78-05597a000300060093-6: '), '');
  assert.equal(sentenceCase('Project Blue Book report'), 'Project Blue Book report');
  const long = cleanTitle('A memorandum about ' + 'something very long '.repeat(20));
  assert.ok(long.length <= 112 && long.endsWith('…'));
});
test('date helpers', () => {
  assert.equal(isPlaceholderDate('1990-01-01T00:00:00Z'), true);
  assert.equal(isPlaceholderDate('1990-06-15T00:00:00Z'), false);
  assert.equal(dayOfYearOk('02-29', 2023), false); assert.equal(dayOfYearOk('02-29', 2024), true);
  assert.deepEqual(denverMMDD(new Date('2026-11-22T06:59:00Z')), { mmdd: '11-21', year: 2026 }); // 23:59 MST the day before
  assert.deepEqual(denverMMDD(new Date('2026-11-22T07:01:00Z')), { mmdd: '11-22', year: 2026 });
});
test('toCandidate rejects Jan 1 / year-only / missing date / bad media; picks the specific collection; builds links', () => {
  assert.equal(toCandidate(doc({ date: '1990-01-01T00:00:00Z' }), libById), null);
  assert.equal(toCandidate(doc({ date: undefined }), libById), null);
  assert.equal(toCandidate(doc({ date: '1963' }), libById), null);
  assert.equal(toCandidate(doc({ mediatype: 'image' }), libById), null);
  const c = toCandidate(doc(), libById)!;
  assert.equal(c.collection, 'ciareadingroom'); assert.equal(c.collectionName, 'The CIA Reading Room Mirror');
  assert.equal(c.url, 'https://archive.org/details/x1'); assert.equal(c.thumbnail, 'https://archive.org/services/img/x1');
});
test('toCandidate: a collection outside the 63 gets a readable name', () => {
  assert.equal(toCandidate(doc({ collection: ['South-Dakota-campaign-finance', 'usgovernmentmirrors'] }), libById)!.collectionName, 'South Dakota campaign finance');
});
test('selectItems spreads collections, caps per year and total, deterministic', () => {
  const c: ArchiveItem[] = [];
  for (let i = 0; i < 30; i++) c.push(item({ identifier: `cia${i}`, collection: 'ciareadingroom', year: 1960 + (i % 3), downloads: 100 - i }));
  for (let i = 0; i < 5; i++) c.push(item({ identifier: `nasa${i}`, collection: 'NASA_NTRS_Archive', year: 2000 + i, downloads: 10 - i }));
  c.push(item({ identifier: 'wh1', collection: 'secret-white-house-recordings', year: 1971 }));
  const a = selectItems(c, { max: 12, perYear: 2 });
  assert.ok(a.length <= 12 && a.some((x) => x.collection === 'NASA_NTRS_Archive') && a.some((x) => x.collection === 'secret-white-house-recordings'));
  const per: Record<number, number> = {}; a.forEach((x) => { per[x.year] = (per[x.year] || 0) + 1; });
  assert.ok(Object.values(per).every((n) => n <= 2));
  assert.deepEqual(a, selectItems([...c].reverse(), { max: 12, perYear: 2 }));
});
test('chunkQueryUrl stays under the ~2.5 KB limit for 10 years and uses the mmdd', () => {
  const url = chunkQueryUrl(Array.from({ length: YEARS_PER_QUERY }, (_, i) => 2016 - i), '11-22');
  assert.ok(url.length < 2500, String(url.length)); assert.match(decodeURIComponent(url), /2016-11-22T00:00:00Z TO 2016-11-22T23:59:59Z/);
});
test('build: Jan 1 skipped without network', async () => {
  let n = 0; const f = await buildOnThisDay({ fetchImpl: (async () => { n++; return reply([]); }) as typeof fetch, lib: collections, mmdd: '01-01', thisYear: 2026 });
  assert.equal(n, 0); assert.equal(f.count, 0); assert.match(f.skipped ?? '', /Jan 1/);
});
test('build: keeps only matching month/day in earlier years; one failed chunk is tolerated', async () => {
  let call = 0;
  const f = await buildOnThisDay({
    lib: collections, mmdd: '11-22', thisYear: 1976, minYear: 1950,
    fetchImpl: (async () => { call++; if (call === 1) throw new Error('boom'); return reply([doc({ identifier: 'a' }), doc({ identifier: 'b', date: '1963-11-23T00:00:00Z' }), doc({ identifier: 'c', date: '1976-11-22T00:00:00Z' })]); }) as typeof fetch,
  });
  assert.deepEqual(f.items.map((i) => i.identifier), ['a']); assert.equal(f.yearErrors, 1);
});
test('build: retries once on 503, and throws (never an empty success) when every query fails', async () => {
  let n = 0;
  const f = await buildOnThisDay({ lib: collections, mmdd: '11-22', thisYear: 1970, minYear: 1950, fetchImpl: (async () => { n++; return n === 1 ? reply([], 503) : reply([doc()]); }) as typeof fetch });
  assert.equal(f.count, 1);
  await assert.rejects(() => buildOnThisDay({ lib: collections, mmdd: '11-22', thisYear: 1970, minYear: 1950, fetchImpl: (async () => reply([], 500)) as typeof fetch }), /every Archive\.org query failed/);
});
