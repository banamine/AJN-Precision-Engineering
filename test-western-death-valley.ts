// Regression: Western → Classic TV → Death Valley Days "The Contract" runs as a 24-hour loop of one Archive episode.
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
const W = await import('./collections/western-death-valley.ts');
const G = await import('./guideRegistry.ts');

const base = W.deathValleyBaseProgram();
assert.equal(base.mediaUrl, '/download/0251114_1101/Death%20Valley%20Days%20S18E24%20The%20Contract.mp4', 'path encoded exactly once');
assert.ok(!/%25/.test(base.mediaUrl), 'no double encoding');
assert.equal(base.metadata?.archiveIdentifier, '0251114_1101', 'existing Archive item id is reused');
assert.equal(base.title, 'Death Valley Days S18E24 The Contract');
assert.equal(base.sourceClass, 'archive_org'); assert.ok(base.assetId && base.sourceId);

// 24-hour loop: one episode repeated start to finish, back to back, with no gap and no overrun.
const day = G.layoutDailySchedule([base], 26, new Date('2026-10-04T12:00:00Z'), 100);
assert.equal(day.length, Math.ceil(86400 / 1543), 'enough repeats to fill 24 h');
assert.equal(day[0].startHour, 0); assert.equal(day[day.length - 1].endHour, 24, 'ends exactly at midnight');
for (let i = 1; i < day.length; i++) assert.equal(day[i].startHour, day[i - 1].endHour, `no gap before slot ${i}`);
assert.equal(new Set(day.map((p) => p.id)).size, day.length, 'each slot has its own id');
assert.equal(new Set(day.map((p) => p.assetId)).size, 1, 'one asset: no duplicate item');
assert.ok(day.every((p) => p.archivePath === base.archivePath));
assert.ok(Math.abs((day[0].endHour! - day[0].startHour!) * 3600 - 1543) < 1, 'full episode length per slot');

// Channel is in the Classic TV guide under the Western group, exactly once, however often the list is read.
for (let n = 0; n < 2; n++) {
  const ch = G.getChannelsByGuide('classic-tv').filter((c: any) => c.id === W.DEATH_VALLEY_CHANNEL_ID);
  assert.equal(ch.length, 1, 'listed once'); assert.equal(ch[0].group, 'Western'); assert.equal(ch[0].guideId, 'classic-tv');
}
assert.equal(G.getChannelById(W.DEATH_VALLEY_CHANNEL_ID)?.group, 'Western');
assert.equal(G.getChannelsByGuide('classic-tv').some((c: any) => c.id === 'honeymooners'), true, 'Honeymooners untouched');
console.log('western death valley: ok');
