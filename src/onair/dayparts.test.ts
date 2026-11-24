import assert from 'node:assert/strict';
import { daypartForHour } from './dayparts';
import { AJN_PLAYOUT as E } from './engine.js';
import { stillToComeToday, comingUp, daypartRest, cycleStart, remainingLabel } from './scheduleView';
import type { Segment } from './runOfShow';

// engine.js and dayparts.ts agree at every Denver hour (use UTC instants in January: Denver = UTC-7)
for (let h = 0; h < 24; h++) {
  const ms = Date.UTC(2027, 0, 12, (h + 7) % 24) + (h + 7 >= 24 ? 86_400_000 : 0);
  assert.equal(E.daypartOf(ms), daypartForHour(h), `hour ${h}`);
}
assert.equal(daypartForHour(17), 'Afternoon'); assert.equal(daypartForHour(18), 'Evening'); assert.equal(daypartForHour(23), 'Late Night'); assert.equal(daypartForHour(5), 'Morning');

const mk = (id: string, name: string, startMs: number, type: 'podcast' | 'music' = 'podcast'): Segment => ({ id, name, type, startMs, endMs: startMs + 600_000 } as unknown as Segment);
const T = (h: number, m = 0, d = 12): number => Date.UTC(2027, 0, d, h + 7, m);   // Denver clock time, 2027-01-d
const list = [mk('a', 'CNN', T(9)), mk('m1', 'Music', T(9, 10), 'music'), mk('b', 'Fox News', T(10)), mk('c', 'Paul Harvey', T(11)), mk('d', 'CNN', T(11, 30)), mk('e', 'The Quash', T(12)), mk('f', 'BBC News', T(13)), mk('g', 'Alex Jones', T(19)), mk('h', 'Late', T(1, 0, 13))];
// exact start second: at the scheduled start a show is no longer "still to come"
assert.deepEqual(stillToComeToday(list, T(10), 9), ['11:00  Paul Harvey', '11:30  CNN', '12:00  The Quash', '13:00  BBC News', '19:00  Alex Jones']);
assert.ok(stillToComeToday(list, T(10) - 1, 9)[0].startsWith('10:00'));
assert.ok(!stillToComeToday(list, T(10), 9).some((l) => l.endsWith('Late')), 'tomorrow is not today');
assert.deepEqual(stillToComeToday([], T(9)), []);
assert.deepEqual(stillToComeToday(list, T(9, 5), 2).length, 2);
// coming up: next three after the current show; music rows never listed
assert.deepEqual(comingUp(list, T(9, 5), 'CNN').map((r) => r.name), ['Fox News', 'Paul Harvey', 'CNN']);
// daypart rest: same daypart (morning 5-11:59 -> nothing after 11:30 CNN except Paul/CNN already in coming up) and never repeats the three
const rest = daypartRest(list, T(9, 5), 'CNN').map((r) => r.name);
assert.deepEqual(rest, []);
assert.deepEqual(daypartRest(list, T(12, 30), 'The Quash').map((r) => r.name), []);      // afternoon: BBC is in coming up
const longer = [...list, mk('x', 'Extra', T(14)), mk('y', 'Extra 2', T(15))].sort((p, q) => p.startMs - q.startMs);
assert.deepEqual(comingUp(longer, T(12, 30), 'The Quash').map((r) => r.name), ['BBC News', 'Extra', 'Extra 2']);
assert.deepEqual(daypartRest(longer, T(12, 30), 'The Quash').map((r) => r.name), []);      // Alex is evening: not the afternoon rest
assert.deepEqual(daypartRest([...longer, mk('z', 'Extra 3', T(16))].sort((p, q) => p.startMs - q.startMs), T(12, 30), 'The Quash').map((r) => r.name), ['Extra 3']);
// midnight: a show at 01:00 tomorrow is not today
assert.equal(stillToComeToday(list, T(23, 59), 4).length, 0);
// cycling advances by whole pages and wraps
assert.equal(cycleStart(0, 5, 2), 0); assert.equal(cycleStart(8000, 5, 2), 2); assert.equal(cycleStart(16000, 5, 2), 4); assert.equal(cycleStart(24000, 5, 2), 0); assert.equal(cycleStart(5, 0, 2), 0);
// countdown never negative
assert.equal(remainingLabel(-3, (s) => String(s)), 'Finishing'); assert.equal(remainingLabel(61, (s) => `${s}s`), '61s');
console.log('dayparts + scheduleView ok');
