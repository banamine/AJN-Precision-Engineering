import assert from 'node:assert/strict';
import { localDateKey, pickForDay, dailyOrder, msUntilLocalMidnight } from './src/utils/dayRotation';

assert.equal(localDateKey(new Date(2026, 9, 11, 23, 59)), '2026-10-11');
assert.equal(localDateKey(new Date(2026, 9, 12, 0, 0)), '2026-10-12');
assert.equal(localDateKey(new Date(2026, 0, 5, 12)), '2026-01-05');

const pool = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
const id = (s: string) => s;
// same date + salt: same picks, whatever the input order
assert.deepEqual(pickForDay(pool, id, '2026-10-11', 3), pickForDay([...pool].reverse(), id, '2026-10-11', 3));
// a different salt gives an independent order
assert.notDeepEqual(dailyOrder(pool, id, '2026-10-11', 'x'), dailyOrder(pool, id, '2026-10-11', 'y'));
// picks are distinct and come from the pool
const three = pickForDay(pool, id, '2026-10-11', 3);
assert.equal(new Set(three).size, 3); assert.ok(three.every((x) => pool.includes(x)));
// the set changes across days, and every item gets picked eventually
const firsts = new Set<string>();
for (let d = 1; d <= 60; d++) firsts.add(pickForDay(pool, id, `2026-10-${String(d).padStart(2, '0')}`, 1)[0]);
assert.ok(firsts.size >= 5, `expected variety across days, got ${firsts.size}`);
assert.deepEqual(pickForDay([], id, '2026-10-11', 3), []);
assert.deepEqual(pickForDay(pool, id, '2026-10-11', 0), []);
assert.equal(pickForDay(pool, id, '2026-10-11', 99).length, pool.length);
// midnight timer
assert.equal(msUntilLocalMidnight(new Date(2026, 9, 11, 23, 0, 0, 0)), 3_600_000);
assert.ok(msUntilLocalMidnight(new Date(2026, 9, 11, 23, 59, 59, 999)) >= 1000);
console.log('test-day-rotation: all passed');
