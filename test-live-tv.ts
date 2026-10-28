// Offline regression: Live TV contract + guide refresh behavior (mocked upstream).
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { checkLiveUrl, liveTvContract } from './server/sources/liveTv.ts';
import { getScheduleForGuide, setLiveTvFetchForTests } from './guideRegistry.ts';
import { buildLiveTvNtdFixture, LIVE_TV_BASE_COUNT, LIVE_TV_EXPECTED_COUNT, NTD_EAST_URL, NTD_EXPECTED_COUNT, NTD_HDLA_URL, NTD_PINNED_NEW_IDS, NTD_RAKUTEN_URL } from './testFixtures/liveTvPinned.ts';

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
const originalPrograms = r.programs.filter((program) => !String(program.metadata?.tvgId ?? '').startsWith('NTDTV'));
assert.equal(originalPrograms.length, 2, 'existing source rows are unchanged');
assert.equal(r.programs.length, 11, 'the nine pins are appended when none duplicate this fixture');
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
assert.equal(first.length, 11);
assert.deepEqual(first.filter((c) => !c.id.startsWith('live-ntdtv-')).map((c) => c.group), ['Movies', 'News']);
assert.equal(first.filter((c) => c.id.startsWith('live-ntdtv-')).length, 9);
setLiveTvFetchForTests(undefined);
mode = 'down';
setLiveTvFetchForTests((async () => new Response('', { status: 503 })) as typeof fetch);
const empty = await getScheduleForGuide('live-tv');
assert.equal(empty.length, 9, 'the static supplement remains available when upstream refreshes fail');
assert.ok(empty.every((channel) => channel.sourceStatus === 'partial'), 'the upstream failure remains visible as partial status');
setLiveTvFetchForTests(undefined);

// One of two lists fails on refresh: its channels stay (last good copy), marked partial.
const other = `#EXTM3U
#EXTINF:-1 group-title="Movies",Rakuten Movie
https://rakuten.example/m.m3u8
`;
let bDown = false;
const two = (async (u: any) => String(u).includes('b.m3u') ? (bDown ? new Response('', { status: 503 }) : new Response(other)) : new Response(m3u)) as typeof fetch;
const srcs = ['https://up/a.m3u', 'https://up/b.m3u'];
const r1 = await liveTvContract.hook({ guideId: 'live-tv', sources: srcs, fetchImpl: two }, ctx);
assert.equal(r1.programs.filter((program) => !String(program.metadata?.tvgId ?? '').startsWith('NTDTV')).length, 3);
assert.equal(r1.programs.length, 12);
bDown = true;
const r2 = await liveTvContract.hook({ guideId: 'live-tv', sources: srcs, fetchImpl: two }, ctx);
assert.equal(r2.programs.filter((program) => !String(program.metadata?.tvgId ?? '').startsWith('NTDTV')).length, 3, 'failed list served from last good copy');
assert.equal(r2.programs.length, 12);
assert.match(r2.error!, /b\.m3u HTTP 503 \(showing last good list\)/);

// A list that is not M3U (e.g. an HTML error page with 200) is an error, not an empty list.
const html = (async () => new Response('<html>rate limited</html>')) as typeof fetch;
const r3 = await liveTvContract.hook({ guideId: 'live-tv', sources: ['https://up/c.m3u'], fetchImpl: html }, ctx);
assert.equal(r3.status, 'partial', 'the pinned supplement is served while the source error remains represented');
assert.match(r3.error!, /not an M3U list/);

// E1: 1,504 synthetic upstream rows plus the pinned supplement -> 1,512;
// the East URL is upstream-owned, while the other eight pins fill gaps.
const ntdFixture = buildLiveTvNtdFixture();
let fixtureCalls = 0;
const fixtureFetch = (async () => { fixtureCalls++; return new Response(ntdFixture, { status: 200 }); }) as typeof fetch;
const ntdResult = await liveTvContract.hook({ guideId: 'live-tv', sources: ['https://fixture.example/us.m3u'], fetchImpl: fixtureFetch }, ctx);
assert.equal(fixtureCalls, 1, 'one in-memory source fixture was read');
assert.equal(ntdResult.programs.length, LIVE_TV_EXPECTED_COUNT);
const ntdPrograms = ntdResult.programs.filter((program) => String(program.metadata?.tvgId ?? '').startsWith('NTDTV'));
assert.equal(ntdPrograms.length, NTD_EXPECTED_COUNT);
assert.equal(new Set(ntdPrograms.map((program) => program.mediaUrl)).size, NTD_EXPECTED_COUNT, '11 distinct NTD URLs');
assert.ok(ntdPrograms.every((program) => program.metadata?.group === 'News'), 'all NTD rows are News');
assert.equal(new Set(ntdPrograms.map((program) => program.channelId)).size, NTD_EXPECTED_COUNT, 'all NTD IDs are stable and unique');
for (const id of ['live-ntdtv-east', 'live-ntdtv-west-hdla', 'live-ntdtv-english-rakuten', ...NTD_PINNED_NEW_IDS]) {
  assert.ok(ntdPrograms.some((program) => program.channelId === id), `stable id ${id}`);
}
const east = ntdPrograms.find((program) => program.mediaUrl === NTD_EAST_URL)!;
assert.equal(east.channelId, 'live-ntdtv-east');
assert.equal(east.metadata?.logo, 'https://upstream.example/east.png', 'upstream metadata wins when the URL is duplicated');
assert.equal(ntdPrograms.find((program) => program.mediaUrl === NTD_HDLA_URL)?.channelId, 'live-ntdtv-west-hdla');
assert.equal(ntdPrograms.find((program) => program.mediaUrl === NTD_RAKUTEN_URL)?.title, 'NTD TV English (Rakuten)');
assert.ok(ntdPrograms.some((program) => program.title === 'NTD TV English (1080p)'));
assert.ok(ntdPrograms.every((program) => /^https:\/\//i.test(String(program.mediaUrl))), 'supplement and upstream URLs are HTTPS');
assert.equal(ntdPrograms.length - 3, 8, 'eight pinned rows are added to the 1,504-row fixture');
assert.equal(ntdResult.programs.length - LIVE_TV_BASE_COUNT, 8);

// E2 + route smoke: real /api/schedule handler, fixture source, and no external network.
const portProbe = net.createServer();
const port = await new Promise<number>((resolve, reject) => {
  portProbe.once('error', reject);
  portProbe.listen(0, '127.0.0.1', () => {
    const address = portProbe.address();
    if (!address || typeof address === 'string') return reject(new Error('Could not reserve test port'));
    portProbe.close((error) => error ? reject(error) : resolve(address.port));
  });
});
const childEnv = { ...process.env, NODE_ENV: 'test', AJN_BOOT_WARMERS: '0', PORT: String(port) };
const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'test-live-tv-api-server.ts'], {
  env: childEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: process.platform !== 'win32',
});
let childOutput = '';
child.stdout.on('data', (chunk: Buffer) => { childOutput = (childOutput + chunk.toString()).slice(-4000); });
child.stderr.on('data', (chunk: Buffer) => { childOutput = (childOutput + chunk.toString()).slice(-4000); });
child.on('error', (error) => { childOutput = `${childOutput}${error.message}`.slice(-4000); });
let apiResponse: Response | null = null;
const readyStarted = Date.now();
const readyDeadline = readyStarted + 60_000;
const deadlineController = new AbortController();
const deadlineTimer = setTimeout(() => deadlineController.abort(new Error('live-TV fixture readiness deadline exceeded')), 60_000);
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const signalChildGroup = (target: ChildProcess, signal: NodeJS.Signals) => {
  if (!target.pid) return;
  if (process.platform === 'win32') {
    target.kill(signal);
    return;
  }
  try {
    process.kill(-target.pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
};
try {
  let attempt = 0;
  let lastConnectionError: unknown;
  while (Date.now() < readyDeadline) {
    if (child.exitCode !== null) throw new Error(`fixture server exited ${child.exitCode}: ${childOutput}`);
    try {
      // One accepted request gets the full remaining 60-second deadline; only
      // fast connection failures are retried, with bounded exponential backoff.
      apiResponse = await fetch(`http://127.0.0.1:${port}/api/schedule?guide=live-tv`, {
        signal: deadlineController.signal,
      });
      break;
    } catch (error) {
      lastConnectionError = error;
      if (deadlineController.signal.aborted || Date.now() >= readyDeadline) break;
      const backoffMs = Math.min(50 * (2 ** Math.min(attempt++, 5)), 1_000, readyDeadline - Date.now());
      if (backoffMs > 0) await delay(backoffMs);
    }
  }
  assert.ok(
    apiResponse,
    `fixture server did not answer /api/schedule?guide=live-tv within 60s; last connection error=${String(lastConnectionError)}; child output: ${childOutput}`,
  );
  assert.equal(apiResponse.status, 200);
  const apiText = await apiResponse.text();
  console.log(`live-tv fixture readiness: ${Date.now() - readyStarted}ms`);
  const apiBody = JSON.parse(apiText) as { channels: Array<{ id: string; group?: string; name: string; programs: Array<{ mediaUrl?: string; metadata?: { tvgId?: string } }> }> };
  assert.equal(apiBody.channels.length, LIVE_TV_EXPECTED_COUNT);
  const apiNtd = apiBody.channels.filter((channel) => String(channel.programs[0]?.metadata?.tvgId ?? '').startsWith('NTDTV'));
  assert.equal(apiNtd.length, NTD_EXPECTED_COUNT);
  assert.ok(apiNtd.every((channel) => channel.group === 'News'));
  assert.equal(new Set(apiNtd.map((channel) => channel.programs[0]?.mediaUrl)).size, NTD_EXPECTED_COUNT);
  const baselineChannels = apiBody.channels.filter((channel) => !NTD_PINNED_NEW_IDS.has(channel.id));
  assert.equal(baselineChannels.length, LIVE_TV_BASE_COUNT);
  const mergedBytes = Buffer.byteLength(apiText);
  const baselineBytes = Buffer.byteLength(JSON.stringify({ ...apiBody, channels: baselineChannels }));
  const payloadDelta = mergedBytes - baselineBytes;
  assert.ok(mergedBytes < 32 * 1024 * 1024, `raw response is below 32 MiB (${mergedBytes} bytes)`);
  assert.ok(payloadDelta > 0, 'pinned rows increase the response payload');
  assert.ok(apiNtd.some((channel) => channel.name === 'NTD TV English (Rakuten)'));
  assert.ok(apiNtd.some((channel) => channel.name === 'NTD TV English (1080p)'));
  console.log(`live-tv NTD fixture: channels ${baselineChannels.length} -> ${apiBody.channels.length}; NTD=${apiNtd.length}; uniqueUrls=${new Set(apiNtd.map((channel) => channel.programs[0]?.mediaUrl)).size}; payload=${mergedBytes} bytes; delta=+${payloadDelta} bytes; Archive=0`);
} finally {
  clearTimeout(deadlineTimer);
  signalChildGroup(child, 'SIGTERM');
  await Promise.race([new Promise<void>((resolve) => child.once('close', () => resolve())), delay(1_500)]);
  signalChildGroup(child, 'SIGKILL');
  if (child.exitCode === null) {
    await Promise.race([new Promise<void>((resolve) => child.once('close', () => resolve())), delay(1_500)]);
  }
}
console.log('live tv regression: all passed');
