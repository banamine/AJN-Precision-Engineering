import assert from 'node:assert/strict';
import { buildClassicUpcoming, createClassicUpcoming, MAX_PAYLOAD_BYTES } from './server/classicUpcoming';
import type { ScheduleChannel, Program } from './src/types';
const now = Date.parse('2026-11-01T08:10:00Z');
const program = (id: string, s: number, e: number): Program => ({ id, title: id, guideId: 'classic-tv', channelId: 'classic-network',
  startTime: 0, endTime: 1, startTimeUtc: new Date(s).toISOString(), endTimeUtc: new Date(e).toISOString(),
  mediaType: 'video', mediaUrl: '/download/SYNTHETIC/a.mp4', metadata: { epg: 'utc', scheduledVod: true } });
const channel = (programs: Program[]): ScheduleChannel => ({ id: 'classic-network', guideId: 'classic-tv', name: 'SYNTHETIC', mediaType: 'video', programs });
const carry = program('carry', now - 600000, now + 600000);
assert.equal(buildClassicUpcoming([channel([carry, carry])], now, 420)[0].programs.length, 1);
assert.equal(buildClassicUpcoming([channel([carry]), channel([carry])], now, 420)[0].programs.length, 1);
assert.throws(() => buildClassicUpcoming([channel([carry, { ...carry, endTimeUtc: new Date(now + 1).toISOString() }])], now, 420));
assert.equal(buildClassicUpcoming([channel([program('ended', now - 1000, now), program('later', now + 48 * 3600000, now + 49 * 3600000)])], now, 420).length, 0);
for (const offset of [0, 420, 480, -330]) {
  assert.equal(buildClassicUpcoming([channel([carry])], now, offset)[0].programs[0].startMs, now - 600000);
}
assert.throws(() => buildClassicUpcoming([channel([program('invalid', now, now)])], now, 420));
const handler = createClassicUpcoming({ getChannels: async () => [channel([{ ...carry, title: 'X'.repeat(100000) }])], now: () => now });
const result = await handler.handle('420');
assert(Buffer.byteLength(JSON.stringify(result.body)) <= MAX_PAYLOAD_BYTES);
assert('truncated' in result.body && result.body.truncated);
for (const sample of [
  { now: '2026-11-01T07:10:00Z', tz: 420, times: ['2026-11-02T06:30:00Z', '2026-11-02T07:30:00Z', '2026-11-02T08:20:00Z', '2026-11-02T09:20:00Z'] },
  { now: '2027-03-14T08:10:00Z', tz: 480, times: ['2027-03-15T05:30:00Z', '2027-03-15T06:30:00Z', '2027-03-15T07:20:00Z', '2027-03-15T08:20:00Z'] },
]) {
  const instant = Date.parse(sample.now);
  const rows = [program('carry', instant - 60000, instant + 60000),
    ...sample.times.map((time, i) => program(`dst-${i}`, Date.parse(time), Date.parse(time) + 60000))]
    .map(p => ({ ...p, metadata: { ...p.metadata, stationZone: 'America/Los_Angeles' } }));
  assert.deepEqual(buildClassicUpcoming([channel(rows)], instant, sample.tz)[0].programs.map(p => p.programId),
    ['carry', 'dst-0', 'dst-1', 'dst-2', 'dst-3'], `Station-calendar bucketing on ${sample.now}`);
}
const legacy = (id: string, hour: number): Program => ({ ...program(id, now, now + 60000),
  startTimeUtc: undefined, endTimeUtc: undefined, startHour: hour, endHour: hour + 1, metadata: {} });
const oldRow = buildClassicUpcoming([channel([legacy('legacy', 12)])], now, 420)[0].programs[0];
assert.deepEqual([oldRow.startMs, oldRow.endMs], [Date.parse('2026-11-01T19:00:00Z'), Date.parse('2026-11-01T20:00:00Z')]);
const mixed = channel([...Array.from({ length: 8 }, (_, i) => program(`abs-${i}`, now + (i + 1) * 3600000, now + (i + 2) * 3600000)),
  ...[12, 13, 14, 25, 26].map(h => legacy(`legacy-${h}`, h))]);
const combined = buildClassicUpcoming([mixed], now, 420)[0].programs;
assert.equal(combined.length, 5);
assert.equal(combined.filter(p => p.programId.startsWith('abs-')).length, 3);
assert.equal(combined.filter(p => ['legacy-25', 'legacy-26'].includes(p.programId)).length, 2);
const many = buildClassicUpcoming(Array.from({ length: 20 }, (_, i) => ({ ...mixed, id: `synthetic-${i}` })), now, 420);
assert.equal(many.length, 16);
assert(many.every(c => c.programs.length <= 5));
console.log('CLASSIC_NETWORK_UPCOMING_PASS cases=11 (19 assertions; SYNTHETIC offline fixtures; carry, intersection, duplicate, conflict, fall-back, spring-forward, offset, legacy, mixed bounds, invalid interval, 60000-byte cap)');
