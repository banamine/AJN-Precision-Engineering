// Offline regression: next available Rush date (gaps skipped, year boundary, end of archive).
import assert from 'node:assert/strict';
const { nextRushDate, getRushIndex } = await import('./server/rush.ts');
const idx = await getRushIndex();
const dates = [...new Set(idx.map((e) => e.date))].sort();
assert.ok(dates.length > 100, 'index loaded');
assert.equal(idx.filter((e) => e.role === 'morning-update').length, 2674);
assert.equal(idx.filter((e) => e.role === 'full-show').length, 3055);
const roleDates = new Map<string, Set<string>>();
for (const entry of idx) {
  const roles = roleDates.get(entry.date) ?? new Set<string>();
  roles.add(entry.role);
  roleDates.set(entry.date, roles);
}
assert.equal([...roleDates.values()].filter((roles) => roles.has('morning-update') && roles.has('full-show')).length, 2666);
assert.ok(!idx.some((e) => e.id.endsWith('2006-02-29')), 'invalid February 29 ID is excluded, not reassigned');
assert.ok(!idx.some((e) => e.id.endsWith('2016-06-31')), 'invalid June 31 ID is excluded');
assert.deepEqual(idx.filter((e) => e.date === '2005-09-20').map((e) => e.role), ['full-show'], 'full-only date has no prelude');
assert.deepEqual(idx.filter((e) => e.date === '2013-07-02').map((e) => e.role), ['morning-update', 'full-show'], 'prelude sorts before the Full Show');

const { pickRushEpisodes } = await import('./server/audioChannels.ts');
const selected = pickRushEpisodes([
  { id: 'rush-limbaugh-radio-show-morning-update-2005-06-03', date: '2005-06-03', year: 2005, role: 'morning-update' },
  { id: 'rush-limbaugh-radio-show-2005-06-03', date: '2005-06-03', year: 2005, role: 'full-show' },
], new Date('2005-06-03T12:00:00Z'), 5);
assert.deepEqual(selected.map((e) => e.role), ['full-show'], 'audio-only Rush channel excludes video preludes');
const i = dates.findIndex((d) => d.startsWith('2005-06'));
assert.equal(await nextRushDate(dates[i]), dates[i + 1], 'next indexed date, not calendar tomorrow');
const lastOf2005 = dates.filter((d) => d.startsWith('2005')).pop()!;
assert.equal((await nextRushDate(lastOf2005))!.slice(0, 4) > '2005', true, 'crosses into the next year');
assert.equal(await nextRushDate(dates[dates.length - 1]), null, 'end of archive');
assert.equal(await nextRushDate('not-a-date'), null);
console.log('rush next-date regression: all passed');
