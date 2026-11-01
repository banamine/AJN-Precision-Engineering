import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { applyFailures, probe, parseRetryAfter } from './tools/catalog-probe.mjs';

const temp = mkdtempSync(join(tmpdir(), 'ajn-catalog-probe-'));
const goodResponse = () => new Response(new Uint8Array([1]), {
  status: 206,
  headers: { 'content-type': 'video/mp4' },
});
const target = (index, host = 'archive.org') => ({
  kind: 'row',
  key: `item-${index}/episode-${index}.mp4`,
  identifier: `item-${index}`,
  file: `episode-${index}.mp4`,
  size: 10_000 + index,
  url: `https://${host}/download/item-${index}/episode-${index}.mp4`,
});
const clockSleep = (clock) => async (ms) => {
  clock.value += ms;
  await new Promise((resolve) => setImmediate(resolve));
};
const metadataPath = (cacheDir, identifier) => join(
  cacheDir,
  'meta',
  `${createHash('md5').update(identifier).digest('hex').slice(0, 16)}.json`,
);
const writeMetadata = (cacheDir, row, mtime, size = row.size) => {
  mkdirSync(join(cacheDir, 'meta'), { recursive: true });
  writeFileSync(metadataPath(cacheDir, row.identifier), JSON.stringify({
    files: [{ name: row.file, size, mtime }],
  }));
};

try {
  assert.equal(parseRetryAfter('2', 100), 2000);
  assert.equal(parseRetryAfter('Wed, 21 Oct 2015 07:28:00 GMT', Date.parse('Wed, 21 Oct 2015 07:27:00 GMT')), 60_000);

  // Four workers overall; no host has more than two requests active.
  const activeByHost = new Map();
  let active = 0;
  let maxActive = 0;
  let maxHostActive = 0;
  const fetchImpl = async (url) => {
    const host = new URL(url).host;
    const hostActive = (activeByHost.get(host) ?? 0) + 1;
    activeByHost.set(host, hostActive);
    active++;
    maxActive = Math.max(maxActive, active);
    maxHostActive = Math.max(maxHostActive, hostActive);
    await new Promise((resolve) => setTimeout(resolve, 3));
    active--;
    activeByHost.set(host, activeByHost.get(host) - 1);
    return goodResponse();
  };
  let result = await probe(
    Array.from({ length: 12 }, (_, i) => target(i, i % 2 ? 'ia800.us.archive.org' : 'archive.org')),
    { fetchImpl, maxWorkers: 4, maxPerHost: 2, intervalMs: 0, timeoutMs: 100 },
  );
  assert.equal(result.ok, 12);
  assert.ok(maxActive <= 4, `overall concurrency ${maxActive} exceeded 4`);
  assert.ok(maxHostActive <= 2, `per-host concurrency ${maxHostActive} exceeded 2`);

  // Fake-clock proof of the per-host physical-start gap, independent of wall-clock timing.
  const paceClock = { value: 0 };
  const pacedStarts = [];
  result = await probe([target(12), target(13), target(14)], {
    maxWorkers: 1,
    intervalMs: 750,
    now: () => paceClock.value,
    sleep: clockSleep(paceClock),
    fetchImpl: async (url) => { pacedStarts.push({ host: new URL(url).host, at: paceClock.value }); return goodResponse(); },
  });
  assert.equal(result.ok, 3);
  assert.deepEqual(pacedStarts.map((x) => x.at), [0, 750, 1500]);

  // A 429 is not retried, but its Retry-After blocks later requests to that same host.
  const cooldownClock = { value: 0 };
  const cooldownStarts = [];
  let cooldownCalls = 0;
  result = await probe([target(20), target(21)], {
    maxWorkers: 1,
    intervalMs: 750,
    now: () => cooldownClock.value,
    sleep: clockSleep(cooldownClock),
    fetchImpl: async (url) => {
      cooldownStarts.push({ host: new URL(url).host, at: cooldownClock.value });
      cooldownCalls++;
      return cooldownCalls === 1
        ? new Response('rate limited', { status: 429, headers: { 'retry-after': '2' } })
        : goodResponse();
    },
  });
  assert.equal(cooldownCalls, 2, '429 is recorded once, not retried');
  assert.equal(result.failed.length, 0);
  assert.equal(result.inconclusive.length, 1);
  assert.equal(result.ok, 1);
  assert.ok(cooldownStarts[1].at - cooldownStarts[0].at >= 2000, 'Retry-After was honored before the next same-host request');

  // A 429 remains in the catalog because it is not a definitive item response.
  const rateLimitedTarget = target(20);
  const rateLimitedData = {
    base: { extra: { channels: [] }, docs: [] },
    head: { extra: { channels: [{ id: 'new-rate-limited', rows: [rateLimitedTarget] }] }, docs: [] },
  };
  const keptAfter429 = applyFailures(rateLimitedData.base, rateLimitedData.head, result.failed.map((failure) => failure.key));
  assert.equal(keptAfter429.extra.channels[0].rows.length, 1);

  // Header timeouts retry once, then remain inconclusive and are not removed.
  let timeoutCalls = 0;
  const timeoutTarget = target(30);
  result = await probe([timeoutTarget], {
    maxWorkers: 1,
    intervalMs: 0,
    timeoutMs: 5,
    deadlineMs: 1000,
    fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
      timeoutCalls++;
      init.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }),
  });
  assert.equal(timeoutCalls, 2, 'a header timeout gets exactly one retry');
  assert.equal(result.failed.length, 0);
  assert.equal(result.inconclusive.length, 1);
  assert.equal(result.inconclusive[0].reason, 'timeout');
  const timeoutData = {
    base: { extra: { channels: [] }, docs: [] },
    head: { extra: { channels: [{ id: 'new-timeout', rows: [timeoutTarget] }] }, docs: [] },
  };
  const keptAfterTimeout = applyFailures(timeoutData.base, timeoutData.head, result.failed.map((failure) => failure.key));
  assert.equal(keptAfterTimeout.extra.channels[0].rows.length, 1);

  // Network errors also get one retry, then remain inconclusive.
  let networkErrorCalls = 0;
  result = await probe([target(32)], {
    maxWorkers: 1,
    intervalMs: 0,
    fetchImpl: async () => { networkErrorCalls++; throw new Error('connection reset'); },
  });
  assert.equal(networkErrorCalls, 2);
  assert.equal(result.failed.length, 0);
  assert.equal(result.inconclusive.length, 1);
  assert.match(result.inconclusive[0].reason, /connection reset/);

  // One 5xx retry only; the second 5xx remains inconclusive.
  let serverErrorCalls = 0;
  result = await probe([target(31)], {
    maxWorkers: 1,
    intervalMs: 0,
    fetchImpl: async () => {
      serverErrorCalls++;
      return new Response('temporary server error', { status: 503, headers: { 'retry-after': '0' } });
    },
  });
  assert.equal(serverErrorCalls, 2);
  assert.equal(result.failed.length, 0);
  assert.equal(result.inconclusive.length, 1);
  assert.equal(result.inconclusive[0].status, 503);

  // Deadline leaves all undispatched work unprobed and resolves normally (the CLI's exit path is 0).
  let forbiddenFetchCalls = 0;
  result = await probe([target(40), target(41), target(42)], {
    deadlineMs: 0,
    now: () => 1000,
    fetchImpl: async () => { forbiddenFetchCalls++; throw new Error('network must not run'); },
  });
  assert.equal(forbiddenFetchCalls, 0);
  assert.equal(result.unprobed, 3);
  assert.equal(result.deadlineHit, true);

  // Exercise the actual CLI deadline path in a temporary Git fixture, with offline fetch hard-blocked.
  const cliRepo = join(temp, 'cli-repo');
  mkdirSync(join(cliRepo, 'config'), { recursive: true });
  mkdirSync(join(cliRepo, 'data'), { recursive: true });
  writeFileSync(join(cliRepo, 'config/catalog-refresh.json'), JSON.stringify({
    dataFiles: { extra: 'data/extra.json', docs: 'data/docs.json' },
  }));
  writeFileSync(join(cliRepo, 'data/extra.json'), JSON.stringify({ channels: [] }));
  writeFileSync(join(cliRepo, 'data/docs.json'), JSON.stringify([]));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: cliRepo });
  execFileSync('git', ['config', 'user.name', 'Offline Test'], { cwd: cliRepo });
  execFileSync('git', ['config', 'user.email', 'offline-test@example.invalid'], { cwd: cliRepo });
  execFileSync('git', ['add', '.'], { cwd: cliRepo });
  execFileSync('git', ['commit', '-qm', 'base fixture'], { cwd: cliRepo });
  writeFileSync(join(cliRepo, 'data/extra.json'), JSON.stringify({
    channels: [{
      guideId: 'classic-tv',
      id: 'fixture-channel',
      rows: [{ identifier: 'fixture-item', file: 'fixture.mp4', bytes: 123, title: 'Fixture' }],
    }],
  }));
  execFileSync('git', ['add', 'data/extra.json'], { cwd: cliRepo });
  execFileSync('git', ['commit', '-qm', 'head fixture'], { cwd: cliRepo });
  const cliResult = spawnSync(process.execPath, [
    resolve('tools/catalog-probe.mjs'),
    '--base', 'HEAD~1',
    '--config', 'config/catalog-refresh.json',
    '--out', 'probe.json',
    '--deadlineMinutes', '0',
    '--cacheDir', '.catalog-cache',
    '--offline', 'true',
  ], { cwd: cliRepo, encoding: 'utf8' });
  assert.equal(cliResult.status, 0, cliResult.stderr);
  const cliProbe = JSON.parse(readFileSync(join(cliRepo, 'probe.json'), 'utf8'));
  assert.equal(cliProbe.requests, 0, 'offline CLI deadline starts no network requests');
  assert.equal(cliProbe.unprobed, 1);
  assert.equal(cliProbe.deadlineHit, true);

  // Results are reused only for the same identifier/file/size/mtime and within the 7-day TTL.
  const cacheDir = join(temp, 'cache');
  const cacheClock = { value: Date.UTC(2026, 9, 31) };
  const cachedTarget = target(50);
  writeMetadata(cacheDir, cachedTarget, 1234);
  let cacheFetchCalls = 0;
  const cacheOptions = {
    cacheDir,
    maxWorkers: 1,
    intervalMs: 0,
    now: () => cacheClock.value,
    fetchImpl: async () => { cacheFetchCalls++; return goodResponse(); },
  };
  result = await probe([cachedTarget], cacheOptions);
  assert.equal(result.cacheHits, 0);
  assert.equal(cacheFetchCalls, 1);
  result = await probe([cachedTarget], cacheOptions);
  assert.equal(result.cacheHits, 1);
  assert.equal(cacheFetchCalls, 1, 'cached row was not re-probed');
  writeMetadata(cacheDir, cachedTarget, 1234, cachedTarget.size + 1);
  result = await probe([cachedTarget], cacheOptions);
  assert.equal(result.cacheHits, 0, 'changed size invalidates the cache key');
  assert.equal(cacheFetchCalls, 2);
  writeMetadata(cacheDir, cachedTarget, 1235, cachedTarget.size + 1);
  result = await probe([cachedTarget], cacheOptions);
  assert.equal(result.cacheHits, 0, 'changed size also invalidates the cache key');
  assert.equal(cacheFetchCalls, 3);
  cacheClock.value += 7 * 24 * 60 * 60 * 1000 + 1;
  result = await probe([cachedTarget], cacheOptions);
  assert.equal(result.cacheHits, 0, 'entries older than seven days expire');
  assert.equal(cacheFetchCalls, 4);
  const cacheFile = join(cacheDir, 'playability-probe-cache.json');
  assert.equal(JSON.parse(readFileSync(cacheFile, 'utf8')).schema, 1);

  // Only definitive failures may be cached; transient results are probed again.
  const outcomeCacheDir = join(temp, 'outcome-cache');
  const limitedCacheTarget = target(60);
  writeMetadata(outcomeCacheDir, limitedCacheTarget, 6000);
  result = await probe([limitedCacheTarget], {
    cacheDir: outcomeCacheDir,
    maxWorkers: 1,
    intervalMs: 0,
    fetchImpl: async () => new Response('rate limited', { status: 429 }),
  });
  assert.equal(result.inconclusive.length, 1);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(outcomeCacheDir, 'playability-probe-cache.json'), 'utf8')).entries), []);

  // Other client-side HTTP errors are inconclusive, retained, and not cached.
  for (const status of [408, 423]) {
    const statusTarget = target(status);
    const statusMtime = status * 100;
    writeMetadata(outcomeCacheDir, statusTarget, statusMtime);
    result = await probe([statusTarget], {
      cacheDir: outcomeCacheDir,
      maxWorkers: 1,
      intervalMs: 0,
      fetchImpl: async () => new Response(`HTTP ${status}`, { status }),
    });
    assert.equal(result.failed.length, 0, `HTTP ${status} is not a definitive failure`);
    assert.equal(result.inconclusive.length, 1);
    assert.equal(result.inconclusive[0].status, status);
    const statusData = {
      base: { extra: { channels: [] }, docs: [] },
      head: { extra: { channels: [{ id: `new-http-${status}`, rows: [statusTarget] }] }, docs: [] },
    };
    const keptAfterStatus = applyFailures(statusData.base, statusData.head, result.failed.map((failure) => failure.key));
    assert.equal(keptAfterStatus.extra.channels[0].rows.length, 1, `HTTP ${status} row remains in the catalog`);
    const statusCacheKey = JSON.stringify([statusTarget.identifier, statusTarget.file, statusTarget.size, statusMtime]);
    const statusCacheEntries = JSON.parse(readFileSync(join(outcomeCacheDir, 'playability-probe-cache.json'), 'utf8')).entries;
    assert.equal(Object.hasOwn(statusCacheEntries, statusCacheKey), false, `HTTP ${status} is not cached`);
  }

  const timedOutCacheTarget = target(61);
  writeMetadata(outcomeCacheDir, timedOutCacheTarget, 6100);
  let timedOutCacheCalls = 0;
  result = await probe([timedOutCacheTarget], {
    cacheDir: outcomeCacheDir,
    maxWorkers: 1,
    intervalMs: 0,
    timeoutMs: 5,
    fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
      timedOutCacheCalls++;
      init.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }),
  });
  assert.equal(timedOutCacheCalls, 2);
  assert.equal(result.inconclusive.length, 1);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(outcomeCacheDir, 'playability-probe-cache.json'), 'utf8')).entries), []);

  const definitiveCacheTarget = target(62);
  writeMetadata(outcomeCacheDir, definitiveCacheTarget, 6200);
  result = await probe([definitiveCacheTarget], {
    cacheDir: outcomeCacheDir,
    maxWorkers: 1,
    intervalMs: 0,
    fetchImpl: async () => new Response('not found', { status: 404 }),
  });
  assert.equal(result.failed.length, 1);
  const cachedDefinitive = Object.values(JSON.parse(readFileSync(join(outcomeCacheDir, 'playability-probe-cache.json'), 'utf8')).entries);
  assert.equal(cachedDefinitive.length, 1);
  assert.equal(cachedDefinitive[0].result.definitive, true);

  // Old transient failures in a version-1 cache are discarded and retried.
  const legacyTarget = target(63);
  const legacyMtime = 6300;
  writeMetadata(outcomeCacheDir, legacyTarget, legacyMtime);
  const legacyKey = JSON.stringify([legacyTarget.identifier, legacyTarget.file, legacyTarget.size, legacyMtime]);
  const legacyCacheFile = join(outcomeCacheDir, 'playability-probe-cache.json');
  writeFileSync(legacyCacheFile, JSON.stringify({
    schema: 1,
    entries: {
      [legacyKey]: { cachedAt: cacheClock.value, result: { status: 429, ok: false, reason: 'HTTP 429' } },
    },
  }));
  let legacyProbeCalls = 0;
  result = await probe([legacyTarget], {
    cacheDir: outcomeCacheDir,
    maxWorkers: 1,
    intervalMs: 0,
    now: () => cacheClock.value,
    fetchImpl: async () => { legacyProbeCalls++; return goodResponse(); },
  });
  assert.equal(result.cacheHits, 0);
  assert.equal(legacyProbeCalls, 1);
  assert.equal(result.ok, 1);

  // Deadline output stays reviewable and progress is emitted exactly every 50 completed targets.
  const progress = [];
  const progressClock = { value: 0 };
  result = await probe(Array.from({ length: 100 }, (_, i) => target(100 + i)), {
    maxWorkers: 4,
    intervalMs: 0,
    now: () => progressClock.value,
    sleep: clockSleep(progressClock),
    fetchImpl: async () => goodResponse(),
    onProgress: (event) => progress.push(event.probed),
  });
  assert.equal(result.probed, 100);
  assert.deepEqual(progress, [50, 100]);

  console.log('PASS catalog-probe-resilience: concurrency, pacing, Retry-After, definitive/inconclusive outcomes, retries, cache safety, deadline, progress');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
