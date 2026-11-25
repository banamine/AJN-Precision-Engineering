// Offline regression for server/concertPools.ts (pure; no network, no Archive).
import assert from 'node:assert/strict';
import { baseOrder, concertPoolTasks, concertTrackPrograms, concertsPerDay, lineupForDay, CONCERT_MAX_SLOTS, type ConcertPool, type ConcertPoolManifest } from './server/concertPools.ts';

const mk = (id: string, tracks: number, secs = 300, extra: Partial<{ art: string | null; thumb: string | null }> = {}) => ({
  id, title: `Show ${id}`, date: '1976-09-18', art: extra.art ?? null, thumb: extra.thumb ?? null,
  tracks: Array.from({ length: tracks }, (_, i) => ({ f: `0${i + 1} Song ${i + 1}.mp3`, t: `Song ${i + 1}`, d: secs, n: i + 1 })),
});
const pool: ConcertPool = { id: 'concert-pool-rock', name: 'Live Concerts: Rock', group: 'Live Concerts', genre: 'Rock',
  concerts: Array.from({ length: 60 }, (_, i) => mk(`c${String(i).padStart(2, '0')}`, 12, 300)) }; // 60 concerts x 1 h
const guide = 'audio-podcasts';

// base order: stable, not alphabetical, independent of manifest order
const a = baseOrder(pool).map((c) => c.id), b = baseOrder({ ...pool, concerts: [...pool.concerts].reverse() }).map((c) => c.id);
assert.deepEqual(a, b, 'base order does not depend on manifest order');
assert.notDeepEqual(a, [...a].sort(), 'base order is not alphabetical');
assert.equal(concertsPerDay(pool), 24, '1 h concerts -> 24 per day');
assert.equal(concertsPerDay({ ...pool, concerts: [mk('a', 3, 100)] }), 1, 'pool shorter than a day loops');

// day-stable, shifts by perDay, covers everything over a cycle
const d1 = new Date('2026-11-03T01:00:00Z'), d1b = new Date('2026-11-03T23:59:00Z'), d2 = new Date('2026-11-04T00:00:01Z');
const ids = (n: Date) => lineupForDay(pool, n).map((c) => c.id);
assert.deepEqual(ids(d1), ids(d1b), 'same UTC day -> same lineup at any hour');
assert.notDeepEqual(ids(d1), ids(d2));
const seen = new Set<string>(); for (let k = 0; k < 4; k++) ids(new Date(Date.UTC(2026, 10, 3 + k))).forEach((x) => seen.add(x));
assert.equal(seen.size, 60, 'every concert airs within ceil(n/perDay)+1 days');
const day = lineupForDay(pool, d1); assert.ok(day.reduce((n, c) => n + c.tracks.length * 300, 0) >= 26 * 3600, 'window covers a UTC day plus margin');

// variable lengths (real pools): no concert is ever skipped over a full cycle
{
  const lens = [6, 10, 12, 40, 3, 25, 8, 15, 30, 9, 50, 5, 20, 11, 7, 33, 4, 18, 60, 2];
  const vp: ConcertPool = { ...pool, id: 'concert-pool-var', concerts: Array.from({ length: 137 }, (_, i) => mk(`v${i}`, lens[i % lens.length], 240 + (i * 37) % 900)) };
  const step = concertsPerDay(vp); const cycle = Math.ceil(vp.concerts.length / step); const air = new Set<string>();
  for (let d = 0; d <= cycle; d++) lineupForDay(vp, new Date(Date.UTC(2026, 10, 3 + d))).forEach((c) => air.add(c.id));
  assert.equal(air.size, vp.concerts.length, `variable-length pool covered ${air.size}/${vp.concerts.length} in ${cycle + 1} days`);
}

// programs: contiguous concerts, display title, structured metadata, encoded proxy-safe paths, honest fields
const p = { ...pool, concerts: [mk("It's/Odd (1)", 3, 200, { art: 'Show Art.JPG', thumb: 'Show Art_thumb.jpg' }), mk('plain', 2, 100)] };
const progs = concertTrackPrograms(p, guide, d1, 0.1);
assert.ok(progs.length >= 3 && progs.every((x) => x.mediaType === 'audio' && x.guideId === guide && x.channelId === 'concert-pool-rock'));
const first = progs[0] as any;
assert.match(first.title, / — Show /); assert.equal(first.metadata.lane, 'music'); assert.equal(first.metadata.durationSource, 'metadata');
assert.equal(first.metadata.trackNo, 1); assert.ok(first.metadata.concertId);
const odd = progs.find((x: any) => x.metadata.concertId === "It's/Odd (1)") as any;
assert.equal(odd.archivePath, `/download/${encodeURIComponent("It's/Odd (1)")}/01%20Song%201.mp3`, 'item id is one encoded segment; file segments encoded');
assert.equal(odd.thumbnailUrl, `/download/${encodeURIComponent("It's/Odd (1)")}/Show%20Art_thumb.jpg`);
const plain = progs.find((x: any) => x.metadata.concertId === 'plain') as any; if (plain) assert.equal(plain.thumbnailUrl, undefined, 'no art -> no thumbnail, never a stand-in');
// tracks of one concert stay adjacent and in track order
const runs = progs.map((x: any) => x.metadata.concertId).filter((v, i, arr) => i === 0 || v !== arr[i - 1]);
assert.equal(new Set(runs).size, runs.length, 'a concert is never split into interleaved runs');
// zero/negative durations are skipped, not invented
const bad = { ...pool, concerts: [{ ...mk('z', 2, 100), tracks: [{ f: 'a.mp3', t: 'A', d: 0, n: 1 }, { f: 'b.mp3', t: 'B', d: 90, n: 2 }] }] };
assert.deepEqual(concertTrackPrograms(bad, guide, d1, 1).map((x: any) => x.metadata.file), ['b.mp3']);

// tasks: one per non-empty pool, empty/missing manifest -> no channel
const manifest: ConcertPoolManifest = { schema: 'ajn.concertPools.v1', source: '@paris-portland', pools: [pool, { ...pool, id: 'concert-pool-empty', concerts: [] }] };
const tasks = concertPoolTasks(manifest, guide, d1);
assert.deepEqual(tasks.map((t) => t.id), ['concert-pool-rock']); assert.equal(tasks[0].maxSlots, CONCERT_MAX_SLOTS); assert.equal(tasks[0].group, 'Live Concerts');
assert.ok((await tasks[0].build()).length > 0);
assert.deepEqual(concertPoolTasks({ schema: 'x', source: 'y', pools: [] }, guide), []); assert.deepEqual(concertPoolTasks(null, guide), []);
console.log('concert pools: all passed');
