import assert from 'node:assert/strict';
import test from 'node:test';
import { DAY_MS, clockEligible, loopSeconds, orderTracks, shuffleWindow, slotAt, slotsAfter, formatDuration, formatRepeat, type SchedItem, type SchedPool, type SchedTrack } from './roundRobinSchedule';

const track = (id: string, n: number, dur?: number): SchedTrack => ({ programId: `${id}::${n}`, archiveId: id, partNo: n, bank: 'concerts', poolId: 'p', channelId: 'c', guideId: 'g', title: `${id} ${n}`, subtitle: id, src: `/download/${id}/${n}.mp3`, durationSeconds: dur });
const item = (id: string, durs: (number | undefined)[]): SchedItem => ({ id, tracks: durs.map((d, i) => track(id, i + 1, d)) });
const pool = (items: SchedItem[], id = 'p'): SchedPool => ({ id, label: id, bank: 'concerts', items });
const big = pool(Array.from({ length: 40 }, (_, i) => item(`album${i}`, [200, 215, 230, 245, 260])));
const T0 = Date.UTC(2026, 10, 10, 12, 0, 0);

test('clock eligibility needs a real duration on every track', () => {
  assert.equal(clockEligible(big), true);
  assert.equal(clockEligible(pool([item('a', [100, undefined])])), false);
  assert.equal(clockEligible(pool([item('a', [100, 0])])), false);
  assert.equal(clockEligible(pool([])), false);
  assert.equal(slotAt(pool([item('a', [100, undefined])]), T0), null);
});
test('round robin: consecutive tracks come from different items while several items have tracks left', () => {
  const order = orderTracks(big, 7);
  assert.equal(order.length, 200);
  for (let i = 1; i < order.length; i++) assert.notEqual(order[i].archiveId, order[i - 1].archiveId);
  assert.equal(new Set(order.map((t) => t.programId)).size, 200, 'every track exactly once per loop');
});
test('deterministic per UTC day + pool, different next day, different pool', () => {
  const a = slotAt(big, T0)!, b = slotAt(big, T0)!;
  assert.deepEqual(a, b);
  assert.notEqual(slotAt(big, T0 + DAY_MS)!.track.programId + slotAt(big, T0 + DAY_MS + 3_600_000)!.track.programId, a.track.programId + slotAt(big, T0 + 3_600_000)!.track.programId);
});
test('timezone invariance: the resolver uses only UTC milliseconds', () => {
  const before = JSON.stringify(slotAt(big, T0));
  const prev = process.env.TZ;
  for (const tz of ['America/Los_Angeles', 'Europe/Berlin', 'Asia/Tokyo']) { process.env.TZ = tz; assert.equal(JSON.stringify(slotAt(big, T0)), before); }
  process.env.TZ = prev;
});
test('slots are contiguous, cover the instant, and chain across the day', () => {
  const s = slotAt(big, T0)!;
  assert.ok(s.startUtcMs <= T0 && T0 < s.endUtcMs);
  const next = slotsAfter(big, s, 3);
  assert.equal(next.length, 3);
  assert.equal(next[0].startUtcMs, s.endUtcMs); assert.equal(next[1].startUtcMs, next[0].endUtcMs); assert.equal(next[2].startUtcMs, next[1].endUtcMs);
  const midnight = Math.floor(T0 / DAY_MS) * DAY_MS + DAY_MS;
  const last = slotAt(big, midnight - 1)!;
  assert.equal(last.endUtcMs, midnight, 'a slot running past UTC midnight is clipped there');
  assert.equal(slotAt(big, midnight)!.startUtcMs, midnight, 'the next day starts a fresh slot at midnight');
  assert.equal(slotsAfter(big, last, 1)[0].startUtcMs, midnight);
});
test('small pool wraps and reports the cycle', () => {
  const small = pool([item('a', [1000, 1000]), item('b', [1000, 1000])]);
  const total = loopSeconds(small, T0)!; assert.equal(total, 4000);
  const dayStart = Math.floor(T0 / DAY_MS) * DAY_MS;
  const s1 = slotAt(small, dayStart + 500_000)!, s2 = slotAt(small, dayStart + 500_000 + 4_000_000)!;
  assert.equal(s1.track.programId, s2.track.programId); assert.equal(s2.cycle, s1.cycle + 1);
  assert.equal(formatRepeat(4000), '1h 07m'); assert.equal(formatRepeat(2400), '40m');
});
test('shuffle window projects start times and wraps; unknown duration gives null, never a guess', () => {
  const order = orderTracks(big, 3);
  const w = shuffleWindow(order, 0, 1_000_000, 3);
  assert.equal(w.length, 3); assert.equal(w[0].startUtcMs, 1_000_000 + (order[0].durationSeconds as number) * 1000);
  assert.equal(shuffleWindow(order, order.length - 1, 0, 1)[0].track.programId, order[0].programId);
  const unknown = orderTracks(pool([item('a', [100, undefined, 50])]), 1);
  assert.equal(shuffleWindow(unknown, 0, 5, 2)[0].startUtcMs, 5 + 100_000); assert.equal(shuffleWindow(unknown, 0, 5, 2)[1].startUtcMs, null);
});
test('duration formatting handles 3+ hour tracks', () => { assert.equal(formatDuration(11687.21), '3:14:47'); assert.equal(formatDuration(222), '3:42'); assert.equal(formatDuration(undefined), '--:--'); });
