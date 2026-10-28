// Offline regression: next available Rush date (gaps skipped, year boundary, end of archive).
import assert from 'node:assert/strict';
const { nextRushDate, getRushIndex } = await import('./server/rush.ts');
const idx = await getRushIndex();
const dates = [...new Set(idx.map((e) => e.date))].sort();
assert.ok(dates.length > 100, 'index loaded');
const i = dates.findIndex((d) => d.startsWith('2005-06'));
assert.equal(await nextRushDate(dates[i]), dates[i + 1], 'next indexed date, not calendar tomorrow');
const lastOf2005 = dates.filter((d) => d.startsWith('2005')).pop()!;
assert.equal((await nextRushDate(lastOf2005))!.slice(0, 4) > '2005', true, 'crosses into the next year');
assert.equal(await nextRushDate(dates[dates.length - 1]), null, 'end of archive');
assert.equal(await nextRushDate('not-a-date'), null);
console.log('rush next-date regression: all passed');
