import assert from 'node:assert/strict';
import type { Program } from './src/types';
import { layoutRotatingDailySchedule } from './server/dailyRotation';
import { getScheduleForGuide, layoutDailySchedule } from './guideRegistry';
import { buildMoviesClassicsPrograms } from './src/services/producers/moviesClassicsProducer';
import manifest from './src/data/moviesClassicsManifest.json';

const day = new Date('2026-10-07T00:00:00Z');
const next = (date: Date, offset = 1) => new Date(date.getTime() + offset * 86_400_000);
const make = (i: number, seconds?: number) => ({
  id: `film-${i}`, guideId: 'movies-classics-vault', channelId: 'classic-cinema',
  title: `Film ${i}`, mediaType: 'video', mediaUrl: `/download/item-${i}/film.mp4`,
  archivePath: `/download/item-${i}/film.mp4`, sourceId: `source-${i}`, assetId: `asset-${i}`,
  metadata: seconds === undefined ? {} : { durationSeconds: seconds },
} as Program);
const films = Array.from({ length: 30 }, (_, i) => make(i));
const baseId = (p: Program) => p.id.replace(/:d\d+$/, '');

function checkDay(schedule: Program[], now: Date) {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  assert.equal(Date.parse(schedule[0].startTimeUtc!), midnight);
  assert.equal(Date.parse(schedule.at(-1)!.endTimeUtc!), midnight + 86_400_000);
  for (let i = 0; i < schedule.length; i++) {
    const p = schedule[i];
    assert.equal(p.id, `${baseId(p)}:d${i}`);
    assert.equal(p.startHour, (Date.parse(p.startTimeUtc!) - midnight) / 3_600_000);
    assert.equal(p.endHour, (Date.parse(p.endTimeUtc!) - midnight) / 3_600_000);
    assert.equal(p.startTime, p.startHour);
    assert.equal(p.endTime, p.endHour);
    assert.ok(p.endHour! <= 24 && p.endHour! > p.startHour!);
    if (i) assert.equal(p.startTimeUtc, schedule[i - 1].endTimeUtc);
  }
}

const original = JSON.stringify(films);
const schedules = [day, next(day), next(day, 2)].map(now => {
  const schedule = layoutRotatingDailySchedule(films, 100, now);
  checkDay(schedule, now);
  assert.equal(new Set(schedule.map(baseId)).size, schedule.length);
  assert.equal(schedule.length, 15);
  return schedule;
});
assert.deepEqual(schedules[0], layoutRotatingDailySchedule(films, 100, day));
assert.deepEqual(schedules[0], layoutRotatingDailySchedule(films, 100, new Date('2026-10-07T23:59:59Z')));
assert.equal(JSON.stringify(films), original, 'Source list is immutable');
assert.equal(new Set(schedules.flatMap(s => s.map(baseId))).size, 30);
for (let d = 0; d < 2; d++) {
  const last = films.findIndex(p => p.id === baseId(schedules[d].at(-1)!));
  assert.equal(baseId(schedules[d + 1][0]), films[(last + 1) % films.length].id);
  schedules[d].forEach((p, i) => assert.notEqual(baseId(p), baseId(schedules[d + 1][i])));
}
assert.equal(baseId(layoutRotatingDailySchedule(films, 100, new Date('2026-01-01T00:00:00Z'))[0]), 'film-0');

const short = [make(0, 3_600), make(1, 7_200)];
const shortDay = layoutRotatingDailySchedule(short, 100, day);
checkDay(shortDay, day);
assert.equal(shortDay.length, 16);
assert.deepEqual(shortDay.map(baseId), Array.from({ length: 16 }, (_, i) => `film-${i % 2}`));
const mixed = [make(0, 9_000), make(1, 0), make(2, -5)];
const mixedDay = layoutRotatingDailySchedule(mixed, 100, new Date('2026-01-01T00:00:00Z'));
assert.equal(mixedDay[0].endHour, 2.5, 'Use source duration when positive');
assert.equal(Date.parse(mixedDay[1].endTimeUtc!) - Date.parse(mixedDay[1].startTimeUtc!), 100 * 60_000, 'Zero uses supplied fallback');
const long = layoutRotatingDailySchedule([make(0, 100_000), make(1)], 100, new Date('2026-01-01T00:00:00Z'));
assert.equal(long.length, 1);
assert.equal(long[0].endHour, 24);
assert.equal(baseId(layoutRotatingDailySchedule([make(0, 100_000), make(1)], 100, new Date('2026-01-02T00:00:00Z'))[0]), 'film-1');
assert.deepEqual(layoutRotatingDailySchedule([], 100, day), []);
assert.throws(() => layoutRotatingDailySchedule(films, 100, new Date('invalid')), RangeError);
assert.throws(() => layoutRotatingDailySchedule(films, 100, new Date('2025-12-31T00:00:00Z')), RangeError);

// Frozen pre-change implementation: byte-for-byte output parity for all other
// daily-layout defaults, including its intentional >24h first-pass behavior.
function legacy(programs: Program[], defaultMinutes: number, now: Date, maxSlots = 60): Program[] {
  if (programs.length === 0) return [];
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const end = day + 24 * 3600_000;
  const out: Program[] = []; let t = day; let slot = 0;
  while ((slot < programs.length || t < end) && slot < maxSlots) {
    for (const p of programs) {
      if ((slot >= programs.length && t >= end) || slot >= maxSlots) break;
      const secs = Number(p.metadata?.durationSeconds) > 0 ? Number(p.metadata?.durationSeconds) : defaultMinutes * 60;
      const stop = slot < programs.length ? t + secs * 1000 : Math.min(t + secs * 1000, end);
      const h = (ms: number) => (ms - day) / 3600_000;
      out.push({ ...p, metadata: { ...(p.metadata ?? {}), airedUtc: p.metadata?.airedUtc ?? p.startTimeUtc }, id: `${p.id}:d${slot}`, startTimeUtc: new Date(t).toISOString(), endTimeUtc: new Date(stop).toISOString(), startTime: h(t), endTime: h(stop), startHour: h(t), endHour: h(stop) });
      t = stop; slot++;
    }
  }
  return out;
}
for (const minutes of [5, 30, 50, 55, 100]) {
  for (const list of [[], short, mixed, films]) {
    assert.equal(JSON.stringify(layoutDailySchedule(list, minutes, day)), JSON.stringify(legacy(list, minutes, day)));
  }
}

// Hermetic resolved 30-film corpus; production still resolves availability live.
const missing = new Set(['AmericanEmpire', 'BorderPatrol1937', 'OsweldsMonster1984', 'TheManWhoKnewToo']);
const resolved = buildMoviesClassicsPrograms(manifest.filter(item => !missing.has(item.identifier)));
assert.equal(resolved.length, 30);
const realDays = [day, next(day), next(day, 2)].map(now => layoutRotatingDailySchedule(resolved, 100, now));
assert.equal(new Set(realDays.flatMap(s => s.map(p => p.assetId))).size, 30);
for (const [i, schedule] of realDays.entries()) {
  checkDay(schedule, next(day, i));
  console.log(`${next(day, i).toISOString().slice(0, 10)}: ${schedule.map(p => p.title).join(' | ')}`);
}
const routeDay = (await getScheduleForGuide('movies-classics-vault', day))[0];
assert.equal(routeDay.id, 'classic-cinema');
checkDay(routeDay.programs, day);
assert.deepEqual(routeDay, (await getScheduleForGuide('movies-classics-vault', new Date('2026-10-07T21:00:00Z')))[0]);
console.log('daily rotation: ALL PASS (UTC clipping, successor rotation, 3-day coverage, wrapping, identity, legacy parity)');
