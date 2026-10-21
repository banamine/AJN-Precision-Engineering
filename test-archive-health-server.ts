import assert from 'node:assert/strict';
import express from 'express';
import { createArchiveHealth } from './server/archiveHealth.ts';
import { startArchiveHealthProber } from './server/archiveHealthProbe.ts';
import { registerArchiveHealthRoutes } from './server/archiveHealthRoutes.ts';
import { fetchArchiveMediaWithRetry, resetArchiveFetchStateForTests } from './server/archiveFetch.ts';
import { recordArchiveHealthOutcome } from './server/archiveHealthRecorder.ts';
import {
  buildArchiveProxyFailureReply,
  clearArchiveProxyFailureCacheForTests,
  getRecentArchiveProxyFailure,
  rememberArchiveProxyFailureUnlessOutage,
} from './server/archiveProxyFailureCache.ts';

let clock = 200_000;
const health = createArchiveHealth({}, { now: () => clock });
for (let i = 0; i < 3; i++) health.record({ ts: clock, itemKey: `fixture-${i}`, kind: 'network' });
assert.equal(health.getStatus().state, 'degraded');

{
  const retryHealth = createArchiveHealth({}, { now: () => clock });
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
  console.log('PASS fake 503 fetch: 9 physical attempts → 3 logical site-health samples');
}

let intervalCallback: (() => void | Promise<void>) | null = null;
const probeCalls: Array<{ url: string; method: string }> = [];
const prober = startArchiveHealthProber({
  health,
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

clock += 60_000;
await intervalCallback?.();
assert.deepEqual(probeCalls, [
  { url: 'https://archive.org/', method: 'HEAD' },
  { url: 'https://control.example/generate_204', method: 'GET' },
]);
assert.equal(health.getStatus().state, 'degraded', 'one successful probe does not recover');
clock += 60_000;
await intervalCallback?.();
assert.equal(health.getStatus().state, 'ok', 'second consecutive successful probe recovers');
prober.stop();

const app = express();
const routeHealth = createArchiveHealth({}, { now: () => clock });
registerArchiveHealthRoutes(app, routeHealth, () => ({
  status: 'ok', service: 'test-proxy', uptime: 10, timestamp: 'fixture-time',
  stats: { totalRequests: 1 },
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
    'control', 'lastFailureAt', 'lastSuccessAt', 'nextProbeAt', 'recent', 'since', 'state',
  ]);
  const healthResponse = await fetch(`${base}/api/health`);
  const healthJson = await healthResponse.json() as Record<string, any>;
  assert.deepEqual(Object.keys(healthJson).sort(), ['archive', 'service', 'stats', 'status', 'timestamp', 'uptime']);
  assert.equal(healthJson.archive, 'ok');
  assert.equal(healthJson.status, 'ok');
  assert.equal(healthJson.stats.totalRequests, 1);
  console.log('PASS local status endpoints: no-store shape and additive health key');
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

clearArchiveProxyFailureCacheForTests();
const reply = buildArchiveProxyFailureReply({ upstreamStatus: 0, attempts: 3, proxyRequestId: 'fixture', errorCode: 'ETIMEDOUT' });
assert.equal(rememberArchiveProxyFailureUnlessOutage('/download/a/a.mp3', reply, 'down'), false);
assert.equal(getRecentArchiveProxyFailure('/download/a/a.mp3'), null);
assert.equal(rememberArchiveProxyFailureUnlessOutage('/download/b/b.mp3', reply, 'unreachable_from_here'), false);
assert.equal(getRecentArchiveProxyFailure('/download/b/b.mp3'), null);
assert.equal(rememberArchiveProxyFailureUnlessOutage('/download/c/c.mp3', reply, 'degraded'), true);
assert.deepEqual(getRecentArchiveProxyFailure('/download/c/c.mp3'), reply);
console.log('PASS outage-period failures are excluded from item failure cache; degraded failures remain diagnostic');
console.log('PASS injected probe: 2 probe rounds, 4 fake requests, 0 real Archive requests');
