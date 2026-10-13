import assert from 'node:assert/strict';
import { getScheduleForGuide, layoutDailySchedule, FILL_DAY_SLOTS } from './guideRegistry';
import { applyShowSources } from './src/services/producers/showSourcesProducer';
import { notWebPlayableVideo, unplayableReason } from './server/sources/archiveLinks';
import showSources from './src/data/archiveShowSourcesManifest.json';

// 1. Old British TV guide: real runtimes, web-playable files, every channel fills the UTC day, two days differ.
const day1 = await getScheduleForGuide('old-british-tv', new Date('2026-10-07T12:00:00Z'));
const day2 = await getScheduleForGuide('old-british-tv', new Date('2026-10-08T12:00:00Z'));
assert.ok(day1.length >= 10, 'Old British TV has its category channels');
const ids = new Set<string>();
for (const ch of day1) {
  assert.ok(ch.programs.length > 0, `${ch.name} has programmes`);
  assert.equal(ch.programs[0].startHour, 0);
  assert.ok(Math.abs(ch.programs[ch.programs.length - 1].endHour! - 24) < 1e-6, `${ch.name} fills the day`);
  for (const p of ch.programs) {
    assert.equal(notWebPlayableVideo(p.archivePath), null, `${p.archivePath} is a web-playable video`);
    assert.equal(unplayableReason(p.archivePath), null);
    assert.ok(!ids.has(p.id), `unique id ${p.id}`); ids.add(p.id);
    assert.ok(p.guideId === 'old-british-tv' && p.mediaType === 'video');
  }
}
const big = (g: typeof day1) => g.find((c) => c.id === 'obt-comedy')!.programs.map((p) => p.title).join('|');
assert.notEqual(big(day1), big(day2), 'rotation moves to new episodes the next day');
assert.deepEqual(day1.map((c) => c.id), (await getScheduleForGuide('old-british-tv', new Date('2026-10-07T01:00:00Z'))).map((c) => c.id));

// 2. Short channels no longer end early: lists repeat to fill 24h; short clips are not cut off at 60 slots.
const mk = (n: number, secs: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, title: `T${i}`, archivePath: `/download/x/${i}.mp4`, metadata: { durationSeconds: secs } })) as any[];
for (const [n, secs] of [[1, 1800], [7, 1800], [60, 120], [387, 120]] as const) {
  const out = layoutDailySchedule(mk(n, secs), 30, new Date('2026-10-07T12:00:00Z'), FILL_DAY_SLOTS);
  assert.ok(Math.abs(out[out.length - 1].endHour! - 24) < 1e-6, `${n}x${secs}s fills 24h`);
}
assert.ok(layoutDailySchedule(mk(60, 30), 30, new Date('2026-10-07T12:00:00Z'), 60).length === 60, 'legacy cap unchanged when callers pass it');

// 3. Show sources: appended, never duplicated, new channel created when unknown.
const base: any[] = [{ id: 'item-corner-gas', guideId: 'classic-tv', name: 'Corner Gas', mediaType: 'video', programs: [] }];
const merged = applyShowSources(base, showSources as any);
const merged2 = applyShowSources(merged, showSources as any);
assert.equal(merged2.find((c) => c.id === 'item-corner-gas')!.programs.length, merged.find((c) => c.id === 'item-corner-gas')!.programs.length, 'idempotent');
assert.ok(merged.length > 1 && merged.every((c) => c.programs.length > 0));
for (const c of merged) for (const p of c.programs) assert.equal(notWebPlayableVideo(p.archivePath), null, p.archivePath);
console.log('PASS old-british-tv + fill-day + show-sources');
