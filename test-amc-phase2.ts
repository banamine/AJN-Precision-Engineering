import assert from 'node:assert/strict';
import { getAllMyChildrenLibraryChannels } from './guideRegistry';
import { layoutRotatingDailySchedule } from './server/dailyRotation';

const [episodes, extras] = [
  (await getAllMyChildrenLibraryChannels()).find((c) => c.id === 'ajn-allmychildren-episodes')!,
  (await getAllMyChildrenLibraryChannels()).find((c) => c.id === 'ajn-allmychildren-extras')!,
];
assert.ok(episodes && extras, 'both AMC channels present');
assert.equal(episodes.programs.length, 557, 'episodes: 557 programs');
assert.equal(extras.programs.length, 619, 'extras: 619 programs');
assert.equal(episodes.programs.length + extras.programs.length, 1176, 'Library total 1,176');

const day1 = new Date('2026-10-19T12:00:00Z');
const a = layoutRotatingDailySchedule(episodes.programs, 45, day1);
const b = layoutRotatingDailySchedule(episodes.programs, 45, new Date('2026-10-19T01:00:00Z'));
assert.deepEqual(a.map((p) => p.id), b.map((p) => p.id), 'deterministic within a UTC day');
assert.equal(new Set(a.map((p) => p.id)).size, a.length, 'no duplicate ids in a day');
assert.equal(a[0].startTimeUtc, '2026-10-19T00:00:00.000Z', 'day starts at 00:00Z');
assert.equal(a.at(-1)!.endTimeUtc, '2026-10-20T00:00:00.000Z', 'day ends at 24:00Z');
for (let i = 1; i < a.length; i++) assert.equal(a[i].startTimeUtc, a[i - 1].endTimeUtc, 'contiguous');
for (const p of a) assert.ok(p.endTime! > p.startTime!, 'every slot has positive length');

// Air-date order preserved, and the next day continues where this one stopped.
const base = (id: string) => id.replace(/:d\d+$/, '');
const order = episodes.programs.map((p) => p.id);
const idx = a.map((p) => order.indexOf(base(p.id)));
for (let i = 1; i < idx.length; i++) assert.equal(idx[i], (idx[i - 1] + 1) % order.length, 'air-date order');
const next = layoutRotatingDailySchedule(episodes.programs, 45, new Date('2026-10-20T12:00:00Z'));
assert.equal(order.indexOf(base(next[0].id)), (idx.at(-1)! + 1) % order.length, 'next day continues in order');

// Extras stay date-only (Library-only).
assert.ok(extras.programs.every((p) => !(p.endTime! > p.startTime!)), 'extras remain 0/0');
console.log(`PASS amc-phase2 | day slots ${a.length} | first ${order.indexOf(base(a[0].id))} -> next day ${order.indexOf(base(next[0].id))}`);
