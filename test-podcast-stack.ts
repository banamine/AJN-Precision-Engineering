// Offline regression for server/podcastStack.ts (fresh-first reverse-chronological stack).
import assert from 'node:assert/strict';
const { layoutFreshFirstStack } = await import('./server/podcastStack.ts');

const DAY = 86400000;
const D0 = Date.UTC(2026, 9, 10);              // 2026-10-10 00:00Z = today's guide-day start
const NOW = new Date(D0 + 12 * 3600_000);
const mk = (show: string, n: string, pubMs: number | null, mins = 30) => ({
  id: `${show}-${n}`, guideId: 'audio-podcasts', channelId: `pod-${show}`, title: `${show} ${n}`, mediaType: 'audio',
  startTimeUtc: new Date(pubMs ?? 0).toISOString(), endTimeUtc: new Date((pubMs ?? 0) + mins * 60000).toISOString(), startTime: 0, endTime: 0,
  metadata: { feedId: show, durationSeconds: mins * 60, airedUtc: pubMs === null ? undefined : new Date(pubMs).toISOString(), ...(pubMs === null ? { backCatalog: true } : {}) },
}) as any;
const seq = (rows: any[]) => rows.map((r) => r.title);

// 1. covers the whole UTC day with no gap or overlap
{
  const pool = [mk('A', '1', D0 - DAY), mk('A', '2', D0 - 2 * DAY), mk('B', '1', D0 - DAY), mk('B', '2', D0 - 3 * DAY)];
  const rows = layoutFreshFirstStack(pool, NOW);
  assert.equal(Date.parse(rows[0].startTimeUtc), D0); assert.equal(Date.parse(rows.at(-1)!.endTimeUtc), D0 + DAY);
  for (let i = 1; i < rows.length; i++) assert.equal(rows[i].startTimeUtc, rows[i - 1].endTimeUtc, `no gap/overlap at ${i}`);
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, 'slot ids are unique');
}

// 2. deterministic: same pool, any time of that day, any instance -> identical schedule
{
  const pool = [mk('A', '1', D0 - DAY), mk('B', '1', D0 - 2 * DAY), mk('C', '1', D0 - 5 * DAY)];
  const a = layoutFreshFirstStack(pool, new Date(D0 + 1000)), b = layoutFreshFirstStack(pool, new Date(D0 + 23 * 3600_000));
  assert.deepEqual(a.map((r) => [r.id, r.startTimeUtc]), b.map((r) => [r.id, r.startTimeUtc]));
}

// 3. order with no history: yesterday first (shows take turns), then T-2, then T-3 ..., then Archive back-catalog, then the cycle repeats
{
  const pool = [mk('A', 'y', D0 - DAY), mk('A', 't2', D0 - 2 * DAY), mk('B', 'y', D0 - DAY), mk('B', 't4', D0 - 4 * DAY), mk('A', 'arch', null), mk('B', 'arch', null)];
  const s = seq(layoutFreshFirstStack(pool, NOW, { historyDays: 0 }));
  assert.deepEqual(s.slice(0, 6), ['A y', 'B y', 'A t2', 'B t4', 'A arch', 'B arch']);
  assert.deepEqual(s.slice(6, 12), ['A y', 'B y', 'A t2', 'B t4', 'A arch', 'B arch'], 'cycle keeps the same order, no early repeats');
}

// 4. newest episode of a show goes before its older ones; a show with several fresh episodes does not binge
{
  const pool = [mk('A', 'new', D0 - DAY + 1000), mk('A', 'old', D0 - DAY - 5000), mk('B', 'new', D0 - DAY - 1000)];
  const s = seq(layoutFreshFirstStack(pool, NOW, { historyDays: 0 }));
  assert.deepEqual(s.slice(0, 3), ['A new', 'B new', 'A old']);
}

// 5. a brand-new episode never cuts audio and airs at the next break, ahead of the backlog
{
  const pub = D0 + 10 * 3600_000 + 7 * 60_000;                      // 10:07
  const pool = [mk('A', 'old1', D0 - 2 * DAY), mk('A', 'old2', D0 - 3 * DAY), mk('A', 'old3', D0 - 4 * DAY), mk('B', 'fresh', pub)];
  const rows = layoutFreshFirstStack(pool, new Date(D0 + 12 * 3600_000));
  const fresh = rows.filter((r) => r.title === 'B fresh');
  assert.ok(fresh.length >= 1, 'fresh episode is on air today');
  const first = Date.parse(fresh[0].startTimeUtc);
  assert.ok(first >= pub, 'never starts before it is published');
  const before = rows.filter((r) => Date.parse(r.endTimeUtc) > pub && Date.parse(r.startTimeUtc) <= pub)[0];
  assert.notEqual(before.title, 'B fresh', 'the slot already on air at 10:07 is not interrupted');
  assert.equal(first, Date.parse(before.endTimeUtc), 'it airs at the very next boundary');
  assert.ok(rows.filter((r) => Date.parse(r.startTimeUtc) < pub).every((r) => r.title !== 'B fresh'));
}

// 6. shows take turns on the same day (no binge of one show)
{
  const pub = D0 + 3600_000;
  const pool = [mk('A', '1', pub), mk('A', '2', pub + 1), mk('B', '1', pub), mk('B', '2', pub + 1), mk('Z', 'old', D0 - 9 * DAY)];
  const rows = layoutFreshFirstStack(pool, NOW);
  const after = rows.filter((r) => Date.parse(r.startTimeUtc) >= pub).slice(0, 4).map((r) => r.title[0]);
  assert.deepEqual(after, ['A', 'B', 'A', 'B']);
}

// 7. only Archive items (no dated episode): plays them in order, still fills the day
{
  const rows = layoutFreshFirstStack([mk('A', 'x', null), mk('A', 'y', null)], NOW);
  assert.equal(rows[0].title, 'A x'); assert.equal(rows[1].title, 'A y'); assert.equal(rows[0].metadata.stackTier, 'archive');
  assert.equal(Date.parse(rows.at(-1)!.endTimeUtc), D0 + DAY);
}

// 8. empty pool is an empty schedule, not an invented one
assert.deepEqual(layoutFreshFirstStack([], NOW), []);

console.log('[podcast-stack] PASS');
