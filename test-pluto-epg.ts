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
console.log('pluto epg regression: all passed');
process.exit(0);
