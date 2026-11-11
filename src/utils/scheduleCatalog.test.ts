import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMusicPools, loadConcertPools, loadFmPools } from './scheduleCatalog';
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
