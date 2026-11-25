import assert from 'node:assert/strict';
import { getScheduleForGuide } from './guideRegistry';
import { MAX_CHANNELS, MAX_PAYLOAD_BYTES, MAX_STALE_MS, PER_CHANNEL, WINDOW_HOURS, buildClassicUpcoming, createClassicUpcoming, type UpcomingBody } from './server/classicUpcoming';

const channels = await getScheduleForGuide('classic-tv', new Date('2026-10-14T12:00:00Z'));
assert.ok(channels.length > 200, 'real Classic schedule loaded');
const NOW = Date.parse('2026-10-14T19:30:00Z'); // 12:30 in UTC-7, 04:30 next day in UTC+9

for (const tz of [420, -540, 0]) { // Date#getTimezoneOffset(): LA = 420, Tokyo = -540
  const out = buildClassicUpcoming(channels, NOW, tz);
  assert.ok(out.length > 0 && out.length <= MAX_CHANNELS, `tz ${tz}: channel count ${out.length}`);
  const localHour = ((NOW / 60000 - tz) / 60) % 24;
  const midnight = NOW - localHour * 3600_000;
  for (const c of out) {
    assert.ok(c.programs.length >= 1 && c.programs.length <= PER_CHANNEL);
    let prev = -Infinity;
    for (const p of c.programs) {
      assert.ok(p.path, 'playable path'); assert.ok(p.endMs > p.startMs);
      assert.ok(p.endMs > NOW - 1 && p.startMs < NOW + WINDOW_HOURS * 3600_000, `${c.id} inside 48 h window`);
      assert.ok(p.startMs >= prev, 'chronological'); prev = p.startMs;
      assert.ok(Math.abs(p.startMs - midnight) < 110 * 3600_000);
    }
  }
  const nextMidnight = midnight + 24 * 3600_000;
  assert.ok(out.some((c) => c.programs.some((p) => p.startMs >= nextMidnight)), `tz ${tz}: some tomorrow programs exist`);
  assert.ok(out.every((c) => c.programs.filter((p) => p.startMs < nextMidnight).length <= 3 && c.programs.filter((p) => p.startMs >= nextMidnight).length <= 2));
  const bytes = Buffer.byteLength(JSON.stringify({ channels: out }));
  assert.ok(bytes <= MAX_PAYLOAD_BYTES, `tz ${tz}: payload ${bytes} B <= ${MAX_PAYLOAD_BYTES}`);
  console.log(`tz ${tz}: ${out.length} channels, ${out.reduce((n, c) => n + c.programs.length, 0)} programs, ${bytes} bytes`);
}
// Same viewer-day => same channels (no reshuffle between requests).
const a = buildClassicUpcoming(channels, NOW, 420).map((c) => c.id), b = buildClassicUpcoming(channels, NOW + 600_000, 420).map((c) => c.id);
assert.deepEqual(a, b);

// Service: fresh -> stale fallback -> pending; bad tz -> 400.
let clock = NOW; let mode: 'ok' | 'pending' | 'throw' = 'ok';
const svc = createClassicUpcoming({ now: () => clock, getChannels: async () => { if (mode === 'throw') throw new Error('boom'); return mode === 'ok' ? channels : null; } });
const r1 = await svc.handle('420'); assert.equal(r1.status, 200); const b1 = r1.body as UpcomingBody; assert.equal(b1.stale, false); assert.equal(b1.pending, false); assert.ok(b1.channels.length > 0);
mode = 'throw'; clock = NOW + 3600_000;
const r2 = (await svc.handle('420')).body as UpcomingBody; assert.equal(r2.stale, true); assert.ok(r2.channels.length > 0); assert.equal(r2.generatedAt, new Date(NOW).toISOString());
mode = 'pending'; clock = NOW + MAX_STALE_MS + 1000;
const r3 = (await svc.handle('420')).body as UpcomingBody; assert.equal(r3.pending, true); assert.equal(r3.channels.length, 0); assert.equal(r3.stale, false);
for (const bad of [undefined, '', 'abc', '99999', '1.5']) assert.equal((await svc.handle(bad)).status, 400, `bad tz ${String(bad)}`);
const fresh = createClassicUpcoming({ now: () => NOW, getChannels: async () => null });
assert.equal(((await fresh.handle('420')).body as UpcomingBody).pending, true, 'no data yet => pending, not empty success');
// Time basis = the TV Guide's: a program placed at startHour h shows at h:00 on the VIEWER'S local clock (EpgGuide.withLocalHours),
// NOT at its startTimeUtc. Row 3 must agree with the Guide it links to, so compare against the source startHour.
// This is a consistency check with the Guide, not proof of an absolute UTC air time (the schedule has none: it is a daily loop laid out from UTC midnight).
{
  const tz = 420, out = buildClassicUpcoming(channels, NOW, tz);
  const localHour = ((NOW / 60000 - tz) / 60) % 24, midnight = NOW - localHour * 3600_000;
  let checked = 0;
  for (const c of out) for (const p of c.programs) {
    // A program id can repeat within a channel at different hours (10 of 18,853 on real data), so match on id AND hour.
    const hours = channels.find((x) => x.id === c.id)!.programs.filter((q) => q.id === p.programId).map((q) => q.startHour ?? q.startTime ?? 0);
    const rowHour = (p.startMs - midnight) / 3600_000;
    assert.ok(hours.some((h) => Math.abs(rowHour - h) < 1e-3), `${c.id}/${p.programId}: Row 3 hour ${rowHour} equals a source startHour of the Guide (${hours.join(', ')})`);
    checked++;
  }
  assert.ok(checked > 20, `checked ${checked} programs`);
  console.log(`guide-basis: ${checked} programs match the Guide's startHour`);
}
console.log('PASS classic-upcoming: window, order, size, determinism, stale fallback, pending, bad tz');
