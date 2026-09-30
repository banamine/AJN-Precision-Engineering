// Offline regression: Pluto listings parsed and attached to Pluto Live TV channels; last good kept.
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
const { parsePlutoChannels, plutoIdOf, getPlutoEpg, refreshPlutoEpg, plutoEpgStats } = await import('./server/sources/plutoEpg.ts');
const ID = '62ba60f059624e000781c436';
assert.equal(plutoIdOf(`https://jmp2.uk/plu-${ID}.m3u8`), ID);
assert.equal(plutoIdOf('https://other.example/a.m3u8'), null);

const api = [
  { _id: ID, name: '00s Replay', timelines: [
    { start: '2026-09-27T10:00:00.000Z', stop: '2026-09-27T10:30:00.000Z', title: 'Friends', episode: { name: 'The One With the Probe', description: 'Ross tests streams.' } },
    { start: '2026-09-27T09:30:00.000Z', stop: '2026-09-27T10:00:00.000Z', title: 'no info available', episode: { name: 'no info available', description: 'no info available' } },
    { start: 'bad', stop: 'x', title: 'skip me' },
  ] },
  { _id: 'ffffffffffffffffffffffff', name: 'Empty', timelines: [] },
];
const m = parsePlutoChannels(api);
assert.equal(m.size, 1);
const slots = m.get(ID)!;
assert.deepEqual(slots.map((s) => s.title), ['00s Replay', 'Friends'], 'sorted; junk titles fall back to the channel name');
assert.equal(slots[1].description, 'The One With the Probe — Ross tests streams.');
assert.equal(slots[0].description, undefined);

// Guide: the Pluto channel gets real program blocks with UTC times; others keep the 24 h block.
const { getScheduleForGuide, setLiveTvFetchForTests } = await import('./guideRegistry.ts');
const m3u = `#EXTM3U
#EXTINF:-1 group-title="Movies",00s Replay
https://jmp2.uk/plu-${ID}.m3u8
#EXTINF:-1 group-title="News",Other
https://other.example/live.m3u8
`;
let plutoUp = true;
const pluto = (async (u: URL | string) => {
  assert.ok(String(u).startsWith('https://api.pluto.tv/v2/channels?start='));
  return plutoUp ? new Response(JSON.stringify(api)) : new Response('', { status: 503 });
}) as unknown as typeof fetch;
setLiveTvFetchForTests((async () => new Response(m3u)) as typeof fetch, pluto);
const list = await getScheduleForGuide('live-tv');
const p = list.find((c) => c.name === '00s Replay')!;
assert.equal(p.programs.length, 2);
assert.equal(p.programs[1].title, 'Friends');
assert.equal(p.programs[1].startTimeUtc, '2026-09-27T10:00:00.000Z');
assert.equal((p.programs[1].metadata as any).epg, 'utc');
assert.equal(p.programs[1].mediaUrl, `https://jmp2.uk/plu-${ID}.m3u8`, 'every block plays the live stream');
assert.notEqual(p.programs[0].id, p.programs[1].id);
assert.equal(list.find((c) => c.name === 'Other')!.programs.length, 1);

// Refresh failure keeps the last good listings.
plutoUp = false;
await refreshPlutoEpg();
assert.match(plutoEpgStats.lastError!, /HTTP 503/);
assert.equal((await getPlutoEpg()).get(ID)!.length, 2);
setLiveTvFetchForTests(undefined);

// --- Sliced fetch: a 24 h window is cut into equal slices so every response stays under the 16 MB cap.
const P = await import('./server/sources/plutoEpg.ts');
const T0 = Date.parse('2026-09-30T12:00:00.000Z'), DAY = 24 * 3600_000;
const wins = P.plutoWindows(T0, T0 + DAY);
assert.equal(wins.length, P.SLICES);
assert.ok(wins.every(([a, b]) => b - a === DAY / P.SLICES), 'slices are equal');
assert.ok(wins.every(([, b], i) => i === wins.length - 1 || b === wins[i + 1][0]) && wins[0][0] === T0 && wins.at(-1)![1] === T0 + DAY, 'contiguous, full coverage');
const a1 = { _id: ID, name: 'X', timelines: [{ start: '2026-09-30T11:30:00.000Z', stop: '2026-09-30T12:30:00.000Z', title: 'Boundary' }] };
const merged = P.mergePlutoSlices([P.parsePlutoChannels([a1]), P.parsePlutoChannels([a1, { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Y', timelines: [{ start: '2026-09-30T13:00:00.000Z', stop: '2026-09-30T14:00:00.000Z', title: 'Later' }] }])]);
assert.equal(merged.get(ID)!.length, 1, 'a program crossing a slice boundary is merged once');
assert.equal(merged.size, 2);

// Simulated server: a response is "too large" (content-length > cap) when its window is wider than 10 h.
const seen: number[] = [];
const sized = (async (u: URL | string) => {
  const q = new URL(String(u)).searchParams, span = Date.parse(q.get('stop')!) - Date.parse(q.get('start')!);
  seen.push(span);
  const body = JSON.stringify([{ _id: ID, name: 'X', timelines: [{ start: q.get('start'), stop: q.get('stop'), title: `t${q.get('start')}` }] }]);
  return new Response(body, { headers: { 'content-length': String(span > 10 * 3600_000 ? 17 * 1024 * 1024 : body.length) } });
}) as unknown as typeof fetch;
P.setPlutoEpgFetchForTests(sized);
await P.refreshPlutoEpg(T0);
assert.equal(seen.length, P.SLICES, 'one request per slice');
assert.ok(seen.every((x) => x === DAY / P.SLICES), 'each request is an equal slice');
assert.equal(P.plutoEpgStats.failedSlices, 0); assert.equal(P.plutoEpgStats.lastError, null);
assert.equal((await P.getPlutoEpg(T0)).get(ID)!.length, P.SLICES, 'all slices merged');

// A slice that is still too large is halved, not dropped.
seen.length = 0;
const fat = (async (u: URL | string) => {
  const q = new URL(String(u)).searchParams, span = Date.parse(q.get('stop')!) - Date.parse(q.get('start')!);
  seen.push(span);
  const body = JSON.stringify([{ _id: ID, name: 'X', timelines: [{ start: q.get('start'), stop: q.get('stop'), title: 'f' }] }]);
  return new Response(body, { headers: { 'content-length': String(span > 4 * 3600_000 ? 17 * 1024 * 1024 : body.length) } });
}) as unknown as typeof fetch;
P.setPlutoEpgFetchForTests(fat);
await P.refreshPlutoEpg(T0);
assert.equal(P.plutoEpgStats.failedSlices, 0, 'oversized slices split until they fit');
assert.ok(seen.some((x) => x <= 4 * 3600_000), 'halved windows were requested');

// One slice failing is not silent and does not blank the guide.
let n = 0;
const flaky = (async (u: URL | string) => {
  const q = new URL(String(u)).searchParams;
  if (++n === 2) return new Response('', { status: 503 });
  return new Response(JSON.stringify([{ _id: ID, name: 'X', timelines: [{ start: q.get('start'), stop: q.get('stop'), title: 'ok' }] }]));
}) as unknown as typeof fetch;
P.setPlutoEpgFetchForTests(flaky);
await P.refreshPlutoEpg(T0);
assert.equal(P.plutoEpgStats.failedSlices, 1);
assert.match(P.plutoEpgStats.lastError!, /partial: 1 of 4 windows failed \(HTTP 503\)/);
assert.equal((await P.getPlutoEpg(T0)).get(ID)!.length, P.SLICES - 1, 'the other slices are still served');
P.setPlutoEpgFetchForTests(undefined);
console.log('pluto epg regression: all passed');
process.exit(0);
