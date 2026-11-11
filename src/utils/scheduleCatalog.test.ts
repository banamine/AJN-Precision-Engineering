import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMusicPools, loadConcertPools, loadFmPools, buildSpokenPools } from './scheduleCatalog';
import { clockEligible, poolTrackCount, slotAt, slotsAfter, type SchedPool } from './roundRobinSchedule';

const keyOk = (p: SchedPool) => p.items.every((i) => i.tracks.every((t, n) => t.programId === `${t.archiveId}::${n + 1}` && t.partNo === n + 1));

test('music: one pool per channel; clock-eligible exactly when every track has a real duration', () => {
  const pools = buildMusicPools(); assert.ok(pools.length >= 60);
  const eligible = pools.filter(clockEligible); const shuffleOnly = pools.length - eligible.length;
  console.log(`music pools ${pools.length}: clock-eligible ${eligible.length}, shuffle-only ${shuffleOnly}`);
  assert.ok(eligible.length >= 60); assert.ok(pools.every(keyOk));
  for (const p of pools) for (const i of p.items) for (const t of i.tracks) assert.ok(t.durationSeconds === undefined || t.durationSeconds > 0, 'no invented/zero durations');
});
test('concerts: all-pool + genre pools, every track has a real duration, raw-id keys', async () => {
  const pools = await loadConcertPools(); const all = pools[0];
  console.log(`concert pools ${pools.length}; all=${all.items.length} concerts / ${poolTrackCount(all)} tracks`);
  assert.equal(all.id, 'concerts-all'); assert.ok(all.items.length >= 1400); assert.ok(pools.every(clockEligible)); assert.ok(pools.every(keyOk));
  const s = slotAt(all, Date.UTC(2026, 10, 10, 19, 0, 0))!; assert.equal(slotsAfter(all, s, 3).length, 3);
});
test('fm: 346 broadcasts, all clock-eligible, bank tagged fm', async () => {
  const pools = await loadFmPools(); assert.equal(pools.length, 1);
  console.log(`fm items ${pools[0].items.length} tracks ${poolTrackCount(pools[0])}`);
  assert.equal(pools[0].items.length, 346); assert.ok(clockEligible(pools[0]) && keyOk(pools[0]));
  assert.ok(pools[0].items.every((i) => i.tracks.every((t) => t.bank === 'fm' && t.poolId === 'fm-broadcasts')));
});
test('podcasts: only real-duration episodes with media, one item per show, group pools first', () => {
  const ep = (id: string, d?: number, est = false, url = `https://x/${id}.mp3`) => ({ id, title: id, mediaUrl: url, metadata: { durationSeconds: d, durationEstimated: est } });
  const pools = buildSpokenPools([
    { id: 'a', name: 'Show A', group: 'Podcast', programs: [ep('a1', 1800), ep('a2', 2700, true), ep('a3', undefined), ep('a1dup', 1800, false, 'https://x/a1.mp3'), ep('a4', 600)] },
    { id: 'b', name: 'Show B', group: 'Podcast', programs: [ep('b1', 900)] },
    { id: 'c', name: 'No durations', group: 'Podcast', programs: [ep('c1', undefined)] },
    { id: 'o', name: 'OTR', group: 'Old-Time Radio', programs: [ep('o1', 1500)] },
    { id: 'z', name: 'Not spoken', group: 'Music', programs: [ep('z1', 100)] },
  ]);
  assert.deepEqual(pools.map((p) => p.id), ['spoken-all-podcasts', 'spoken-all-otr', 'spoken-o', 'spoken-a', 'spoken-b']);
  assert.deepEqual(pools[0].items.map((i) => i.id), ['a', 'b']);
  assert.deepEqual(pools[3].items[0].tracks.map((t) => t.programId), ['a1', 'a4']);
  assert.ok(pools.every((p) => clockEligible(p) && p.bank === 'podcasts'));
  assert.ok(pools[0].items.every((i) => i.tracks.every((t) => t.guideId === 'audio-podcasts' && t.channelId === i.id)));
});
