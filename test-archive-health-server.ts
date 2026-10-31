import assert from 'node:assert/strict';
import express from 'express';
import { createArchiveHealth, type ArchiveHealthLogEntry } from './server/archiveHealth.ts';
import { startArchiveHealthProber } from './server/archiveHealthProbe.ts';
import { registerArchiveHealthRoutes } from './server/archiveHealthRoutes.ts';
import { fetchArchiveMediaWithRetry, resetArchiveFetchStateForTests } from './server/archiveFetch.ts';
import { createLogicalArchiveHealthRecorder, recordArchiveHealthOutcome } from './server/archiveHealthRecorder.ts';
import {
  buildArchiveProxyFailureReply,
  clearArchiveProxyFailureCacheForTests,
  getRecentArchiveProxyFailure,
  rememberArchiveProxyFailureForDiagnostic,
} from './server/archiveProxyFailureCache.ts';

let clock = 200_000;
const health = createArchiveHealth({}, { now: () => clock, log: () => {} });
for (let i = 0; i < 3; i++) health.record({ ts: clock, itemKey: `fixture-${i}`, kind: 'network' });
assert.equal(health.getStatus().state, 'degraded');

{
  const retryLines: ArchiveHealthLogEntry[] = [];
  const retryHealth = createArchiveHealth({}, { now: () => clock, log: (line) => retryLines.push(line) });
  let physicalCalls = 0;
  resetArchiveFetchStateForTests();
  const fakeFetch = (async () => {
    physicalCalls += 1;
    return new Response('synthetic failure', { status: 503 });
  }) as typeof fetch;
  for (let i = 0; i < 3; i++) {
    const path = `/download/retry-fixture-${i}/file.mp3`;
    const result = await fetchArchiveMediaWithRetry(`https://archive.org${path}`, {
      headers: { Range: 'bytes=0-0', 'User-Agent': 'test' },
      fetchImpl: fakeFetch,
      sleep: async () => {},
    });
    assert.equal(result.status, 503);
    assert.equal(result.attempts, 3);
    recordArchiveHealthOutcome(retryHealth, { path, status: result.status, ts: clock });
  }
  assert.equal(physicalCalls, 9, 'three retries per item remain one logical health sample per item');
  assert.deepEqual(retryHealth.getStatus().recent, { failures: 3, successes: 0, distinctItems: 3 });
  assert.equal(retryHealth.getStatus().state, 'degraded');
  assert.equal(retryLines.length, 3, 'each exhausted logical request is recorded once, not once per retry');
  console.log('PASS fake 503 fetch: 9 physical attempts → 3 logical site-health samples');
}

{
  const retrySuccessLines: ArchiveHealthLogEntry[] = [];
  const retryHealth = createArchiveHealth({}, { now: () => clock, log: (line) => retrySuccessLines.push(line) });
  const statuses = [503, 503, 200, 206];
  let physicalCalls = 0;
  resetArchiveFetchStateForTests();
  const fakeFetch = (async () => {
    physicalCalls++;
    const status = statuses.shift() ?? 500;
    return new Response(null, { status });
  }) as typeof fetch;
  const path = '/download/retry-success-fixture/file.mp4';
  const result = await fetchArchiveMediaWithRetry(`https://archive.org${path}`, {
    headers: { Range: 'bytes=0-1', 'User-Agent': 'test' },
    fetchImpl: fakeFetch,
    sleep: async () => {},
    log: () => {},
  });
  assert.equal(result.status, 206);
  assert.equal(result.attempts, 3);
  recordArchiveHealthOutcome(retryHealth, { path, status: result.status, ts: clock });
  assert.equal(physicalCalls, 4, 'two failed retries, one successful resolver request, one media request');
  assert.equal(retryHealth.getStatus().recent.successes, 1);
  assert.equal(retryHealth.getStatus().recent.failures, 0);
  assert.equal(retrySuccessLines.length, 1);
  assert.equal(retrySuccessLines[0].kind, 'ok');
  console.log('PASS two failed physical attempts then success → one logical ok sample');
}

{
  const singleFlightLines: ArchiveHealthLogEntry[] = [];
  const singleFlightHealth = createArchiveHealth({}, { now: () => clock, log: (line) => singleFlightLines.push(line) });
  const recordOnce = createLogicalArchiveHealthRecorder(singleFlightHealth, '/services/search/v1/scrape?q=secret');
  recordOnce({ ts: clock, status: 200 });
  recordOnce({ ts: clock, status: 200 });
  assert.equal(singleFlightLines.length, 1, 'a coalesced logical request is recorded only once');
  assert.equal(singleFlightLines[0].path, '/services/search/v1/scrape');
  assert.equal(singleFlightHealth.getStatus().recent.successes, 1);
  console.log('PASS coalesced logical request creates one health outcome');
}

{
  const keys: Array<string> = [];
  const classHealth = createArchiveHealth({}, { now: () => clock, log: (line) => keys.push(line.itemKey) });
  for (const path of [
    '/services/search/v1/scrape?q=one',
    '/advancedsearch.php?q=two',
    '/metadata?identifier=missing',
    '/metadata/',
    '/services/collection-rss.php?collection=tvnews',
  ]) {
    recordArchiveHealthOutcome(classHealth, { path, status: 503, ts: clock });
  }
  assert.deepEqual(keys, ['search', 'search', 'metadata', 'metadata', 'home']);
  assert.equal(classHealth.getStatus().state, 'down', 'the three request classes count as three distinct keys');
  assert.deepEqual(classHealth.getStatus().recent, { failures: 5, successes: 0, distinctItems: 3 });
  console.log('PASS requests without item identifiers use stable search/metadata/home keys');
}

let intervalCallback: (() => void | Promise<void>) | null = null;
const probeCalls: Array<{ url: string; method: string }> = [];
const probeLines: ArchiveHealthLogEntry[] = [];
const probeHealth = createArchiveHealth({}, { now: () => clock, log: (line) => probeLines.push(line) });
for (let i = 0; i < 5; i++) {
  probeHealth.record({ ts: clock, itemKey: `probe-fixture-${i}`, kind: 'network', errorCode: 'ECONNRESET' });
}
const prober = startArchiveHealthProber({
  health: probeHealth,
  now: () => clock,
  controlUrl: 'https://control.example/generate_204',
  intervalMs: 1,
  timeoutMs: 50,
  setIntervalImpl: ((callback: () => void) => {
    intervalCallback = callback;
    return { unref() {} } as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval,
  clearIntervalImpl: (() => {}) as typeof clearInterval,
  fetchImpl: (async (input, init) => {
    const url = String(input);
    const method = String(init?.method ?? 'GET');
    probeCalls.push({ url, method });
    return new Response(null, { status: url === 'https://archive.org/' ? 200 : 204 });
  }) as typeof fetch,
});

clock += 20_000;
await intervalCallback?.();
assert.deepEqual(probeCalls, [
  { url: 'https://archive.org/', method: 'HEAD' },
  { url: 'https://control.example/generate_204', method: 'GET' },
]);
assert.equal(probeHealth.getStatus().state, 'down', 'one successful Archive probe does not recover an outage');
clock += 20_000;
await intervalCallback?.();
assert.equal(probeHealth.getStatus().state, 'ok', 'second successful Archive outcome recovers after degraded window');
assert.equal(probeHealth.getStatus().recent.failures, 5, 'the 60-second failure window is unchanged; recovery comes from two successes');
assert.equal(probeLines.filter((line) => line.itemKey === 'archive-probe').length, 2);
assert.equal(probeLines.filter((line) => line.itemKey === 'control-probe').length, 2);
prober.stop();

{
  // Regression: probes were running at 2x the intended spacing. lastProbeAt is stamped after the request
  // finishes, so a timer firing exactly one interval after the previous tick landed just before the next
  // probe was due and was skipped.
  let jitterClock = 1_000_000;
  const jitterHealth = createArchiveHealth({}, { now: () => jitterClock, log: () => {} });
  for (const key of ['j-a', 'j-b', 'j-c', 'j-d', 'j-e']) jitterHealth.record({ ts: jitterClock, itemKey: key, kind: 'network' });
  assert.equal(jitterHealth.getStatus().state, 'down');
  let jitterTick: (() => void | Promise<void>) | undefined;
  let tickPeriod = 0;
  const probeTimes: number[] = [];
  const jitterProbe = startArchiveHealthProber({
    health: jitterHealth,
    now: () => jitterClock,
    controlUrl: 'https://control.example/generate_204',
    setIntervalImpl: ((callback: () => void, ms: number) => {
      jitterTick = callback;
      tickPeriod = ms;
      return { unref() {} } as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval,
    clearIntervalImpl: (() => {}) as typeof clearInterval,
    fetchImpl: (async (input) => {
      const url = String(input);
      if (url === 'https://archive.org/') probeTimes.push(jitterClock);
      jitterClock += 700; // the request takes time, so the probe is stamped after it finishes
      return new Response(null, { status: url === 'https://archive.org/' ? 200 : 204 });
    }) as typeof fetch,
  });
  assert.ok(tickPeriod > 0 && tickPeriod <= 5_000, 'prober ticks frequently and lets shouldProbe decide');
  for (let elapsed = 0; elapsed < 100_000; elapsed += tickPeriod) {
    jitterClock += tickPeriod;
    await jitterTick?.();
    if (jitterHealth.getStatus().state === 'ok') break;
  }
  assert.equal(jitterHealth.getStatus().state, 'ok', 'recovers after two successful probes');
  assert.ok(probeTimes.length === 2, `exactly two probes were needed, saw ${probeTimes.length}`);
  assert.ok(probeTimes[1] - probeTimes[0] >= 20_000, `second probe ${probeTimes[1] - probeTimes[0]} ms after the first (must respect the 20-second interval)`);
  assert.ok(probeTimes[1] - probeTimes[0] < 25_000, `second probe ${probeTimes[1] - probeTimes[0]} ms after the first (must recover within two probe intervals)`);
  jitterProbe.stop();
  console.log('PASS probes keep the configured 20-second spacing despite request time');
}

{
  let redirectClock = 700_000;
  const redirectHealth = createArchiveHealth({}, { now: () => redirectClock, log: () => {} });
  for (const key of ['redirect-a', 'redirect-b', 'redirect-c', 'redirect-d', 'redirect-e']) {
    redirectHealth.record({ ts: redirectClock, itemKey: key, kind: 'network', errorCode: 'ETIMEDOUT' });
  }
  assert.equal(redirectHealth.getStatus().state, 'down');
  let redirectTick: (() => void | Promise<void>) | undefined;
  const archiveRequests: RequestInit[] = [];
  const redirectProbe = startArchiveHealthProber({
    health: redirectHealth,
    now: () => redirectClock,
    controlUrl: 'https://control.example/generate_204',
    setIntervalImpl: ((callback: () => void) => {
      redirectTick = callback;
      return { unref() {} } as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval,
    clearIntervalImpl: (() => {}) as typeof clearInterval,
    fetchImpl: (async (input, init) => {
      if (String(input) === 'https://archive.org/') {
        archiveRequests.push(init ?? {});
        return new Response(null, { status: 301, headers: { location: 'https://www.archive.org/' } });
      }
      return new Response(null, { status: 204 });
    }) as typeof fetch,
  });
  redirectClock += 20_000;
  await redirectTick?.();
  assert.equal(redirectHealth.getStatus().state, 'down', 'one 301 response is only one recovery success');
  redirectClock += 20_000;
  await redirectTick?.();
  assert.equal(redirectHealth.getStatus().state, 'ok', 'two Archive 301 responses recover within two 20-second intervals');
  assert.equal(archiveRequests.length, 2, 'no redirect target was fetched');
  assert.equal(archiveRequests.every((init) => init.method === 'HEAD' && init.redirect === 'manual'), true);
  assert.deepEqual(redirectHealth.getStatus().lastCountedEvents.slice(-2).map((event) => [event.kind, event.httpStatus]), [
    ['ok', 301], ['ok', 301],
  ]);
  redirectProbe.stop();
  console.log('PASS Archive HEAD 301 is reachable; two responses recover within 40 seconds without following Location');
}

{
  let blockedClock = 500_000;
  const blockedControlHealth = createArchiveHealth({}, { now: () => blockedClock, log: () => {} });
  for (const key of ['block-a', 'block-b', 'block-c', 'block-d', 'block-e']) {
    blockedControlHealth.record({ ts: blockedClock, itemKey: key, kind: 'network' });
  }
  let fakeArchiveCalls = 0;
  let blockedTick: (() => void | Promise<void>) | undefined;
  const blockedProbe = startArchiveHealthProber({
    health: blockedControlHealth,
    now: () => blockedClock,
    controlUrl: 'https://archive.org/should-not-be-a-control-host',
    intervalMs: 1,
    fetchImpl: (async () => {
      fakeArchiveCalls += 1;
      return new Response('synthetic server error', { status: 503 });
    }) as typeof fetch,
    setIntervalImpl: ((callback: () => void) => {
      blockedTick = callback;
      return {} as ReturnType<typeof setInterval>;
    }) as typeof setInterval,
    clearIntervalImpl: (() => {}) as typeof clearInterval,
  });
blockedClock += 20_000;
  assert.ok(blockedTick);
  await blockedTick();
  assert.equal(fakeArchiveCalls, 1, 'the mock catches the only Archive URL; blocked control URL is never fetched');
  assert.equal(blockedControlHealth.getStatus().control, 'unknown');
  assert.equal(blockedControlHealth.getStatus().state, 'down');
  blockedProbe.stop();
  console.log('PASS blocked control URL is not fetched or misreported as unreachable');
}

const app = express();
const routeHealth = createArchiveHealth({}, { now: () => clock });
registerArchiveHealthRoutes(app, routeHealth, () => ({
  status: 'ok', service: 'test-proxy', uptime: 10, timestamp: 'fixture-time',
  stats: { totalRequests: 1, bodyStallsUpstream: 2, bodyStallsBackpressure: 3 },
}));
const server = app.listen(0, '127.0.0.1');
try {
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const status = await fetch(`${base}/api/archive/status`);
  assert.equal(status.status, 200);
  assert.equal(status.headers.get('cache-control'), 'no-store');
  const statusJson = await status.json() as Record<string, any>;
  assert.deepEqual(Object.keys(statusJson).sort(), [
    'control', 'lastCountedEvents', 'lastFailureAt', 'lastSuccessAt', 'lastTransitionAt',
    'lastTransitionReason', 'nextProbeAt', 'recent', 'since', 'state',
  ]);
  assert.deepEqual(statusJson.lastCountedEvents, []);
  const healthResponse = await fetch(`${base}/api/health`);
  const healthJson = await healthResponse.json() as Record<string, any>;
  assert.deepEqual(Object.keys(healthJson).sort(), ['archive', 'service', 'stats', 'status', 'timestamp', 'uptime']);
  // fresh health with no counted success/failure reports 'unknown', not a fabricated 'ok'
  assert.equal(healthJson.archive, 'unknown');
  assert.equal(statusJson.state, 'unknown');
  assert.equal(healthJson.status, 'ok');
  assert.equal(healthJson.stats.totalRequests, 1);
  assert.equal(healthJson.stats.bodyStallsUpstream, 2);
  assert.equal(healthJson.stats.bodyStallsBackpressure, 3);
  console.log('PASS local status endpoints: no-store shape and additive health key');
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

clearArchiveProxyFailureCacheForTests();
const reply = buildArchiveProxyFailureReply({ upstreamStatus: 0, attempts: 3, proxyRequestId: 'fixture', errorCode: 'ETIMEDOUT' });
rememberArchiveProxyFailureForDiagnostic('/download/a/a.mp3', reply);
assert.deepEqual(getRecentArchiveProxyFailure('/download/a/a.mp3'), reply, 'outage-time proxy failures remain available to the player diagnostic');
rememberArchiveProxyFailureForDiagnostic('/download/b/b.mp3', reply);
assert.deepEqual(getRecentArchiveProxyFailure('/download/b/b.mp3'), reply, 'unreachable-upstream failures remain diagnostic');
rememberArchiveProxyFailureForDiagnostic('/download/c/c.mp3', reply);
assert.deepEqual(getRecentArchiveProxyFailure('/download/c/c.mp3'), reply);
const definiteReply = buildArchiveProxyFailureReply({ upstreamStatus: 403, attempts: 1, proxyRequestId: 'definite-fixture' });
rememberArchiveProxyFailureForDiagnostic('/download/private/private.mp3', definiteReply);
assert.deepEqual(getRecentArchiveProxyFailure('/download/private/private.mp3'), definiteReply, 'item-specific failures are diagnostic-only and expire by the short cache TTL');
const unplayableReply = buildArchiveProxyFailureReply({ upstreamStatus: 422, attempts: 0, proxyRequestId: 'member-fixture', errorCode: 'UNPLAYABLE_ARCHIVE_MEMBER' });
rememberArchiveProxyFailureForDiagnostic('/download/item/file.zip/item.mp3', unplayableReply);
assert.deepEqual(getRecentArchiveProxyFailure('/download/item/file.zip/item.mp3'), unplayableReply);
console.log('PASS short-lived player diagnostics retain outage, item-specific, and unplayable responses');
console.log('PASS injected probe: 2 probe rounds, 4 fake requests, 0 real Archive requests');
