import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEdition, parseDenverDateTime, showRulesFromSources, type DailySourceConfig, type FeedEpisode, type FeedInput } from './dailyEdition';
import { editionToPool, shelfTrack } from './editionPool';
import { clockEligible, loopSeconds, slotAt, slotsAfter } from './roundRobinSchedule';

const rules = showRulesFromSources([{ id: 'a', name: 'A', dailyPriority: 1 }, { id: 'b', name: 'B', dailyPriority: 2 }] as DailySourceConfig[]);
const ep = (id: string, pub: number, mins: number): FeedEpisode => ({ guid: id, programId: `pod-${id}`, title: id, src: `https://m.example/${id}.mp3`, publishedMs: pub, durationSeconds: mins * 60, durationSource: 'rss' });
function edition(day: string, pubDay: string) {
  const now = parseDenverDateTime(`${day} 01:00`); const pub = parseDenverDateTime(`${pubDay} 08:00`);
  const feeds: FeedInput[] = [{ rule: rules[0], episodes: [ep(`a-${day}`, pub, 120)] }, { rule: rules[1], episodes: [ep(`b-${day}`, pub, 90)] }];
  return buildEdition(feeds, now);
}
const E1 = edition('2026-11-20', '2026-11-19'), E2 = edition('2026-11-21', '2026-11-20');

test('edition pool: eligible, loop length is the loop only, slots are unclipped at UTC midnight', () => {
  const p = editionToPool(E1);
  assert.equal(clockEligible(p), true); assert.equal(loopSeconds(p, E1.startMs), (120 + 90) * 60);
  const last = p.edition!.slots[p.edition!.slots.length - 1];
  assert.ok(last.endUtcMs >= E1.endMs, 'the tail fills the whole edition');
  assert.ok(p.edition!.slots.every((s) => s.endUtcMs - s.startUtcMs === s.track.durationSeconds! * 1000), 'no slot is cut');
});
test('slotAt: the slot containing the instant; null before the start and after the last slot ends', () => {
  const p = editionToPool(E1); const s = p.edition!.slots;
  assert.equal(slotAt(p, s[0].startUtcMs)!.track.title, 'a-2026-11-20');
  assert.equal(slotAt(p, s[1].startUtcMs - 1)!.index, 0); assert.equal(slotAt(p, s[1].startUtcMs)!.index, 1);
  assert.equal(slotAt(p, s[0].startUtcMs - 1), null); assert.equal(slotAt(p, s[s.length - 1].endUtcMs), null);
  assert.equal(slotAt(p, s[0].startUtcMs)!.editionId, E1.editionId);
});
test('slotsAfter: next slots in the same edition; first items of the NEW edition when the slot is from an older one', () => {
  const p1 = editionToPool(E1), p2 = editionToPool(E2);
  const cur = slotAt(p1, p1.edition!.slots[1].startUtcMs)!;
  assert.deepEqual(slotsAfter(p1, cur, 2).map((x) => x.index), [2, 3]);
  const crossed = slotsAfter(p2, cur, 1)[0];
  assert.equal(crossed.editionId, E2.editionId); assert.equal(crossed.index, 0); assert.equal(crossed.track.title, 'a-2026-11-21');
  const last = slotAt(p1, p1.edition!.slots[p1.edition!.slots.length - 1].startUtcMs)!;
  assert.deepEqual(slotsAfter(p1, last, 1), [], 'end of the edition: nothing is invented');
});
test('slotsAfter for a play-now slot returns what is live next', () => {
  const p = editionToPool(E1); const t = p.edition!.slots[1].startUtcMs + 60_000;
  const demand = { track: shelfTrack({ ...E1.loop[0] }), startUtcMs: t, endUtcMs: t + 1000, index: -1, cycle: 1, demand: true };
  assert.equal(slotsAfter(p, demand, 1)[0].index, 1, 'the slot live at that moment comes first');
});
