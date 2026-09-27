// Offline regression: Live TV health — hidden only after two failed checks, back after one success,
// no marking when most channels fail at once (our network), offline channels hidden from the guide.
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
const { checkStream, runHealthCheck, healthOf, pendingRechecks, setLiveHealthFetchForTests, liveHealthStats } = await import('./server/liveHealth.ts');

const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv/index.m3u8\n';
const down = new Set<string>();
const net = (async (u: URL | string) => {
  const s = String(u);
  const host = new URL(s).hostname;
  if (down.has(host)) return new Response('', { status: 404 });
  if (host === 'variant-dead.example' && s.includes('/v/')) return new Response('', { status: 403 });
  if (host === 'html.example') return new Response('<html>');
  return new Response(s.includes('/v/') ? '#EXTM3U\n#EXTINF:6,\na.ts\n' : master);
}) as unknown as typeof fetch;
setLiveHealthFetchForTests(net);

assert.deepEqual(await checkStream('https://good.example/live.m3u8'), { ok: true });
assert.deepEqual(await checkStream('https://variant-dead.example/live.m3u8'), { ok: false, reason: 'variant HTTP 403' });
assert.equal((await checkStream('https://html.example/live.m3u8')).reason, 'not an HLS playlist');
assert.equal((await checkStream('http://good.example/live.m3u8')).ok, false, 'http refused by the bounded fetch');

const urls = Array.from({ length: 12 }, (_, i) => `https://c${i}.example/live.m3u8`);
down.add('c0.example');
await runHealthCheck(urls);
assert.equal(healthOf(urls[0]), 'ok', 'one failure does not hide a channel');
assert.deepEqual(pendingRechecks(), [urls[0]]);
await runHealthCheck(pendingRechecks(), 8, false);
assert.equal(healthOf(urls[0]), 'offline', 'second failure hides it');
assert.equal(liveHealthStats.offline, 1);
down.delete('c0.example');
await runHealthCheck(urls);
assert.equal(healthOf(urls[0]), 'ok', 'one success brings it back');

// Our network down: 12/12 fail -> nothing marked.
for (let i = 0; i < 12; i++) down.add(`c${i}.example`);
const r = await runHealthCheck(urls);
assert.equal(r.applied, false);
await runHealthCheck(urls);
assert.equal(healthOf(urls[5]), 'ok', 'mass failure never hides channels');
assert.equal(liveHealthStats.skippedRun, true);
down.clear();

// Guide: offline channel hidden from the Live TV list.
const { getScheduleForGuide, setLiveTvFetchForTests } = await import('./guideRegistry.ts');
const m3u = `#EXTM3U
#EXTINF:-1 group-title="News",Alive
https://alive.example/live.m3u8
#EXTINF:-1 group-title="News",Dead
https://dead.example/live.m3u8
`;
setLiveTvFetchForTests((async () => new Response(m3u)) as typeof fetch);
setLiveHealthFetchForTests(net);
down.add('dead.example');
await runHealthCheck(['https://alive.example/live.m3u8', 'https://dead.example/live.m3u8'], 8, false);
await runHealthCheck(['https://dead.example/live.m3u8'], 8, false);
const list = await getScheduleForGuide('live-tv');
assert.deepEqual(list.map((c) => c.name), ['Alive']);
setLiveTvFetchForTests(undefined);
console.log('live health regression: all passed');
process.exit(0);
