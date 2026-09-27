// Offline regression: Live TV contract + guide refresh behavior (mocked upstream).
import assert from 'node:assert/strict';
import { checkLiveUrl, liveTvContract } from './server/sources/liveTv.ts';
import { getScheduleForGuide, setLiveTvFetchForTests } from './guideRegistry.ts';

assert.equal(checkLiveUrl('https://jmp2.uk/plu-62ba60f059624e000781c436.m3u8'), null);
assert.equal(checkLiveUrl('http://example.com/a.m3u8'), 'not https (blocked as mixed content on an https page)');
assert.equal(checkLiveUrl('https://s.rocketdns.info:8080/monstercable/Dq6jjknxCr/3637'), 'credentialed panel restream');

const m3u = `#EXTM3U
#EXTINF:-1 tvg-id="00sReplay.us" tvg-logo="https://img/x.png" group-title="Movies",00s Replay
https://jmp2.uk/plu-62ba60f059624e000781c436.m3u8
#EXTINF:-1 group-title="News;General",Some News
https://news.example/live/index.m3u8
#EXTINF:-1 group-title="Sports",ESPN 2
http://s.rocketdns.info:8080/monstercable/Dq6jjknxCr/3637
#EXTINF:-1 group-title="XXX",Nope
https://adult.example/a.m3u8
#EXTINF:-1 group-title="Movies",00s Replay duplicate url
https://jmp2.uk/plu-62ba60f059624e000781c436.m3u8
`;
const ctx = { now: new Date('2026-09-23T12:00:00Z'), signal: new AbortController().signal };
const ok = (async () => new Response(m3u, { status: 200 })) as typeof fetch;
const r = await liveTvContract.hook({ guideId: 'live-tv', sources: ['https://up/us.m3u'], fetchImpl: ok }, ctx);
assert.equal(r.programs.length, 2);
assert.equal(r.status, 'partial');
assert.deepEqual(r.rejected.map((x) => x.reason).sort(), ['adult group', 'not https (blocked as mixed content on an https page)']);
const p = r.programs.find((x) => x.title === '00s Replay')!;
assert.equal(p.mediaUrl, 'https://jmp2.uk/plu-62ba60f059624e000781c436.m3u8', 'stream URL used exactly');
assert.equal(p.startTimeUtc, '2026-09-23T00:00:00.000Z');
assert.equal(p.endTimeUtc, '2026-09-24T00:00:00.000Z');
assert.equal((p.metadata as any).group, 'Movies');
assert.equal(r.programs.find((x) => x.title === 'Some News')!.metadata!.group, 'News');

// Guide: first load fetches; a failed refresh keeps the last good list, marked.
let mode: 'ok' | 'down' = 'ok';
setLiveTvFetchForTests((async () => mode === 'ok' ? new Response(m3u, { status: 200 }) : new Response('', { status: 503 })) as typeof fetch);
const first = await getScheduleForGuide('live-tv');
assert.equal(first.length, 2);
assert.deepEqual(first.map((c) => c.group), ['Movies', 'News']);
setLiveTvFetchForTests(undefined);
mode = 'down';
setLiveTvFetchForTests((async () => new Response('', { status: 503 })) as typeof fetch);
const empty = await getScheduleForGuide('live-tv');
assert.equal(empty[0].id, 'live-tv-status');
assert.equal(empty[0].sourceStatus, 'upstream_error');
assert.match(empty[0].sourceError!, /HTTP 503/);
setLiveTvFetchForTests(undefined);
console.log('live tv regression: all passed');
