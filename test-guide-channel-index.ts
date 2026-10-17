import assert from 'node:assert/strict';
import { sortChannelsAlpha, numberChannels, categoryCounts, buildSearchIndex, filterChannels, ALL_CATEGORIES, stationLabel, fold } from './src/guide/channelIndex';
import type { ScheduleChannel } from './src/types';

const prog = (title: string) => ({ id: title, title, guideId: 'g', channelId: 'c', startTime: 0, endTime: 1, mediaType: 'video' } as any);
const ch = (id: string, name: string, group: string | undefined, titles: string[] = [], mediaType: 'video' | 'audio' = 'video'): ScheduleChannel =>
  ({ id, guideId: 'g', name, mediaType, group, programs: titles.map(prog) });
const list = [
  ch('z', 'Zorro', 'Classic TV', ['Zorro Rides']), ch('o', 'The Odd Couple', 'Classic TV', ['The Laundry Orgy']), ch('c10', 'Channel 10', 'News'),
  ch('c2', 'Channel 2', 'News'), ch('a', 'ABC Radio', 'Old-Time Radio', ['Suspense: Sorry Wrong Number'], 'audio'), ch('e', 'Éclair TV', undefined), ch('b', 'Bonanza', 'Classic TV', ['Hoss Cartwright']),
];

// 1. Alphabetical: articles ignored, numbers numeric, accents folded; deterministic.
const sorted = sortChannelsAlpha(list).map((c) => c.id);
assert.deepEqual(sorted, ['a', 'b', 'c2', 'c10', 'e', 'o', 'z']);
assert.deepEqual(sortChannelsAlpha([...list].reverse()).map((c) => c.id), sorted, 'input order must not matter');
assert.deepEqual(sortChannelsAlpha([ch('2', 'Same', ''), ch('1', 'Same', '')]).map((c) => c.id), ['1', '2'], 'ties broken by id');

// 2. Sequential station numbers 1..N, unique, unaffected by filtering.
const numbered = numberChannels(list);
assert.deepEqual(numbered.map((n) => n.station), [1, 2, 3, 4, 5, 6, 7]);
assert.equal(stationLabel(7), '007');
const index = buildSearchIndex(numbered);
const news = filterChannels(numbered, index, '', 'news');
assert.deepEqual(news.rows.map((r) => [r.channel.id, r.station]), [['c2', 3], ['c10', 4]], 'filtered rows keep their global station numbers');

// 3. Categories: group or Video/Audio fallback, counted.
const cats = categoryCounts(numbered);
assert.deepEqual(cats.map((c) => [c.label, c.count]), [['Classic TV', 3], ['News', 2], ['Old-Time Radio', 1], ['Video', 1]]);

// 4. Search: name, group, station number, and show titles; all terms must match; accent/case-insensitive.
const q = (s: string, c = ALL_CATEGORIES) => filterChannels(numbered, index, s, c);
assert.deepEqual(q('odd').rows.map((r) => r.channel.id), ['o']);
assert.deepEqual(q('ECLAIR').rows.map((r) => r.channel.id), ['e'], 'accent + case folded');
const show = q('wrong number');
assert.deepEqual(show.rows.map((r) => r.channel.id), ['a']);
assert.equal(show.matchedShow.get('a'), 'Suspense: Sorry Wrong Number', 'show hits report the matching title');
assert.deepEqual(q('classic hoss').rows.map((r) => r.channel.id), ['b'], 'terms AND across group + show');
assert.deepEqual(q('radio', 'news').rows, [], 'category and query combine');
assert.deepEqual(q('   ').rows.length, 7, 'blank query = everything');
assert.deepEqual(q('nonsense-xyz').rows, []);
assert.equal(fold('  Éclair   TV '), 'eclair tv');

// 5. Scale: 1,500 channels x 130 programs indexes and filters well inside a frame budget.
const big = Array.from({ length: 1500 }, (_, i) => ch('x' + i, 'Channel ' + ((i * 7919) % 1500), i % 2 ? 'Classic TV' : 'Movies', Array.from({ length: 130 }, (_, k) => `Show ${i}-${k}`)));
const nb = numberChannels(big);
let t = performance.now(); const bi = buildSearchIndex(nb); const build = performance.now() - t;
t = performance.now(); const r = filterChannels(nb, bi, 'show 77-12', ALL_CATEGORIES); const search = performance.now() - t;
assert.ok(r.rows.length >= 1 && build < 1500 && search < 100, `index ${build.toFixed(0)}ms search ${search.toFixed(0)}ms`);
console.log(`[guide-channel-index] PASS — sort, station numbers, categories, search; 1500x130 index ${build.toFixed(0)} ms, search ${search.toFixed(1)} ms`);

// 6. "On now" predicate narrows the list and combines with category + query; station numbers stay put.
{
  const only = (ids: string[]) => (c: ScheduleChannel) => ids.includes(c.id);
  const r1 = filterChannels(numbered, index, '', ALL_CATEGORIES, only(['b', 'c2']));
  assert.deepEqual(r1.rows.map((r) => [r.channel.id, r.station]), [['b', 2], ['c2', 3]]);
  assert.deepEqual(filterChannels(numbered, index, '', 'news', only(['b', 'c2'])).rows.map((r) => r.channel.id), ['c2'], 'category + on-now');
  assert.deepEqual(filterChannels(numbered, index, 'hoss', ALL_CATEGORIES, only(['c2'])).rows, [], 'query + on-now');
  assert.equal(filterChannels(numbered, index, '', ALL_CATEGORIES, undefined).rows.length, 7, 'no predicate = no narrowing');
}
