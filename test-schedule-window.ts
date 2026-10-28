import assert from 'node:assert/strict';
import { windowByHour, localHourAt } from './server/scheduleWindow';
import { layoutMusicDailySchedule } from './guideRegistry';
const day = Date.UTC(2026, 9, 11);
const mk = (n: number, sec: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, guideId: 'g', channelId: 'c', title: `T${i}`, mediaType: 'audio', metadata: { durationSeconds: sec }, startTimeUtc: '', endTimeUtc: '' }) as any);
const full = layoutMusicDailySchedule(mk(48, 210), new Date(day + 20 * 3600_000));
// 1. the loop covers all 24 grid hours (the old 48-row cap stopped at ~2.8 h)
assert.equal(full[0].startHour, 0); assert.ok(full[full.length - 1].endHour >= 23.99);
// 2. any local hour gets rows that cover it, and the size is bounded
for (const h of [0.2, 6, 13.7, 15.4, 22, 23.9]) {
  const w = windowByHour(full, h);
  assert.ok(w.some((p: any) => p.startHour <= h && p.endHour > h), `covers ${h}`);
  assert.ok(w.length <= 160 && w.length < full.length, `bounded at ${h}: ${w.length}`);
  const byId = new Map(full.map((p: any) => [p.id, p]));
  for (const p of w) assert.equal(byId.get(p.id)?.startHour, p.startHour, 'hours unchanged');
}
// 3. no row from outside the asked-for span
const w = windowByHour(full, 15.4); for (const p of w as any[]) assert.ok(p.endHour > 12.4 && p.startHour < 24.4);
// 4. local hour from the viewer's offset: PDT is getTimezoneOffset() = 420
const nowMs = Date.UTC(2026, 9, 11, 22, 24); // 22:24Z
assert.ok(Math.abs((localHourAt(nowMs, '420') as number) - 15.4) < 1e-9, 'PDT');
assert.ok(Math.abs((localHourAt(nowMs, '0') as number) - 22.4) < 1e-9, 'UTC');
assert.ok(Math.abs((localHourAt(nowMs, '-330') as number) - (22.4 + 5.5 - 24)) < 1e-9, 'IST wraps past midnight');
assert.equal(localHourAt(nowMs, undefined), null); assert.equal(localHourAt(nowMs, 'abc'), null); assert.equal(localHourAt(nowMs, '99999'), null);
console.log('schedule window: PASS', { full: full.length, at15_4: windowByHour(full, 15.4).length });
