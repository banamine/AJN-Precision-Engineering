import assert from 'node:assert/strict';
import { denverParts, markRows } from './listenDayparts.ts';

// 2026-11-26 12:00 UTC = 05:00 MST (UTC-7)
const t0 = Date.UTC(2026, 10, 26, 12, 0);
assert.deepEqual(denverParts(t0), { dayKey: '2026-11-26', hour: 5 });
const H = 3600 * 1000;
const m = markRows([t0, t0 + 3 * H, t0 + 7 * H, t0 + 13 * H, t0 + 18 * H, t0 + 25 * H], t0);
assert.deepEqual(m[0], { day: 'Today', daypart: 'Morning' });
assert.deepEqual(m[1], {});                       // 08:00 still morning
assert.deepEqual(m[2], { daypart: 'Afternoon' }); // 12:00
assert.deepEqual(m[3], { daypart: 'Evening' });   // 18:00
assert.deepEqual(m[4], { daypart: 'Late Night' });// 23:00
assert.deepEqual(m[5], { day: 'Tomorrow', daypart: 'Morning' }); // next day 06:00
assert.deepEqual(markRows([null], t0), [{}]);
console.log('listenDayparts ok');
