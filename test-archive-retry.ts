// Unit regression: Archive proxy retries transient upstream errors only.
import assert from 'node:assert/strict';
import {
  ARCHIVE_HEADER_WAIT_BUDGET_MS,
  archiveHostCircuitBreaker,
  createHeaderWaitBudget,
  fetchArchiveMediaWithRetry,
  NODE_HEADER_TIMEOUT_MS,
  resetArchiveFetchStateForTests,
  type FetchImpl,
} from './server/archiveFetch.ts';
import {
  ArchiveRateLimitError,
  ArchiveCooldownStore,
  buildArchiveRateLimitHttpResponse,
  parseRetryAfter,
  sharedArchiveCooldownStore,
  type ArchiveCooldownTimers,
} from './server/archiveCooldown.ts';
import { archiveApiFetch } from './server/archiveLimiter.ts';

const DOWNLOAD = 'https://archive.org/download/nova-wonders/file.mp4';
const NODE = 'https://dn721905.ca.archive.org/0/items/nova-wonders/file.mp4';

type Step = { match: 'download' | 'node'; status: number };

function scriptedFetch(steps: Step[]) {
  const calls: { url: string; range: string | null }[] = [];
  const impl = (async (input: any, init?: any) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, range: headers.get('range') });
    const step = steps.shift();
    assert.ok(step, `unexpected fetch ${url}`);
    assert.equal(url.startsWith('https://archive.org/') ? 'download' : 'node', step.match, `wrong target for ${url}`);
    if (step.status === 302) {
      return new Response(null, { status: 302, headers: { location: NODE } });
    }
    const body = step.status < 300 ? 'media-bytes' : 'upstream error';
    return new Response(body, {
      status: step.status,
      headers: step.status === 206 ? { 'content-range': 'bytes 0-10/422000000', 'content-type': 'video/mp4' } : {},
    });
  }) as FetchImpl;
  return { impl, calls };
}

const noSleep = async () => {};
const logs: Record<string, unknown>[] = [];
const log = (_m: string, d: Record<string, unknown>) => { logs.push(d); };
const headers = { 'User-Agent': 'test', Accept: '*/*', Range: 'bytes=0-10' };

// 1. 500, 500, then 206 → success on the third attempt, Range kept every time.
{
  const { impl, calls } = scriptedFetch([
    { match: 'download', status: 302 }, { match: 'node', status: 200 }, { match: 'node', status: 500 },
    { match: 'download', status: 302 }, { match: 'node', status: 200 }, { match: 'node', status: 500 },
    { match: 'download', status: 302 }, { match: 'node', status: 200 }, { match: 'node', status: 206 },
  ]);
  logs.length = 0;
  const result = await fetchArchiveMediaWithRetry(DOWNLOAD, { headers, fetchImpl: impl, sleep: noSleep, log, requestId: 'req-1' });
  assert.equal(result.status, 206);
  assert.equal(result.attempts, 3);
  assert.equal(result.failure, undefined);
  const mediaCalls = calls.filter((c) => c.range !== null && c.range !== 'bytes=0-0');
  assert.equal(mediaCalls.length, 3, 'three media fetches');
  assert.ok(mediaCalls.every((c) => c.range === 'bytes=0-10'), 'Range sent on every attempt');
  assert.equal(logs.length, 2, 'two retry warnings');
  assert.equal(logs[0].requestId, 'req-1');
  assert.equal(logs[0].upstreamStatus, 500);
  console.log('PASS 500,500,206 → 206 after 3 attempts');
}

// 2. 403 restricted → returned immediately, no retry.
{
  const { impl } = scriptedFetch([
    { match: 'download', status: 302 }, { match: 'node', status: 200 }, { match: 'node', status: 403 },
  ]);
  const result = await fetchArchiveMediaWithRetry(DOWNLOAD, { headers, fetchImpl: impl, sleep: noSleep, log });
  assert.equal(result.status, 403);
  assert.equal(result.attempts, 1);
  assert.equal(result.failure, 'media');
  console.log('PASS 403 → no retry');
}

// Unsafe Archive redirects are rejected once as a policy failure, with no alternate lookup.
{
  let calls = 0;
  const impl = (async () => {
    calls++;
    return new Response(null, { status: 302, headers: { location: 'https://outside.example/file.mp4' } });
  }) as FetchImpl;
  const result = await fetchArchiveMediaWithRetry(DOWNLOAD, { headers, fetchImpl: impl, sleep: noSleep, log });
  assert.equal(calls, 1, 'rejected redirect must not try alternates or retry');
  assert.equal(result.status, 502);
  assert.equal(result.attempts, 1);
  assert.equal(result.failure, 'resolve');
  assert.equal(result.reason, 'Archive redirect rejected: outside.example');
  console.log('PASS unsafe 302 redirect → 502 policy failure, 1 request, 0 retries');
}

// 3. Persistent 500 → gives up after 3 attempts, still reports failure.
{
  const steps: Step[] = [];
  for (let i = 0; i < 3; i++) steps.push({ match: 'download', status: 302 }, { match: 'node', status: 200 }, { match: 'node', status: 500 });
  const { impl } = scriptedFetch(steps);
  const result = await fetchArchiveMediaWithRetry(DOWNLOAD, { headers, fetchImpl: impl, sleep: noSleep, log });
  assert.equal(result.status, 500);
  assert.equal(result.attempts, 3);
  assert.equal(result.failure, 'media');
  console.log('PASS persistent 500 → fails after 3 attempts');
}

// 4. 503 during redirect resolution is retried too.
{
  const { impl } = scriptedFetch([
    { match: 'download', status: 503 },
    { match: 'download', status: 302 }, { match: 'node', status: 200 }, { match: 'node', status: 206 },
  ]);
  const result = await fetchArchiveMediaWithRetry(DOWNLOAD, { headers, fetchImpl: impl, sleep: noSleep, log });
  assert.equal(result.status, 206);
  assert.equal(result.attempts, 2);
  console.log('PASS resolve-stage 503 → retried');
}

// 5. Aborted request is never retried.
{
  const controller = new AbortController();
  const { impl } = scriptedFetch([
    { match: 'download', status: 302 }, { match: 'node', status: 200 }, { match: 'node', status: 500 },
  ]);
  const result = await fetchArchiveMediaWithRetry(DOWNLOAD, {
    headers, fetchImpl: impl, log, signal: controller.signal,
    sleep: async () => { controller.abort(); },
  });
  assert.equal(result.attempts, 1);
  console.log('PASS aborted client → no further attempts');
}

// 6. A node that drops the connection → served from another replica listed in Archive metadata.
{
  const calls: string[] = [];
  const impl = (async (input: any, init?: any) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith('https://archive.org/download/')) return new Response(null, { status: 302, headers: { location: NODE } });
    if (url.startsWith('https://dn721905.ca.archive.org/')) throw new TypeError('fetch failed');
    if (url === 'https://archive.org/metadata/nova-wonders') {
      return Response.json({ dir: '/0/items/nova-wonders', server: 'dn721905.ca.archive.org', d1: 'dn600306.us.archive.org', workable_servers: ['dn600306.us.archive.org', 'evil.example.com'] });
    }
    if (url === 'https://dn600306.us.archive.org/0/items/nova-wonders/file.mp4') {
      assert.equal(new Headers(init?.headers).get('range'), 'bytes=0-10', 'Range kept on the alternate node');
      return new Response('media-bytes', { status: 206, headers: { 'content-range': 'bytes 0-10/422000000', 'content-type': 'video/mp4' } });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as FetchImpl;
  logs.length = 0;
  const result = await fetchArchiveMediaWithRetry(DOWNLOAD, { headers, fetchImpl: impl, sleep: noSleep, log, requestId: 'req-6' });
  assert.equal(result.status, 206);
  assert.equal(result.failure, undefined);
  assert.ok(calls.includes('https://dn600306.us.archive.org/0/items/nova-wonders/file.mp4'));
  assert.ok(!calls.some((url) => url.includes('evil.example.com')), 'hosts outside archive.org are never contacted');
  assert.equal(logs.length, 1);
  console.log('PASS unreachable node → alternate replica');
}

// 7. No replica reachable → clean failure (no exception), so the proxy can answer 502 quickly.
{
  const impl = (async (input: any) => {
    const url = String(input);
    if (url.startsWith('https://archive.org/download/')) return new Response(null, { status: 302, headers: { location: NODE } });
    if (url.startsWith('https://archive.org/metadata/')) return new Response('{}', { status: 500 });
    throw new TypeError('fetch failed');
  }) as FetchImpl;
  const result = await fetchArchiveMediaWithRetry(DOWNLOAD, { headers, fetchImpl: impl, sleep: noSleep, log });
  assert.equal(result.response, null);
  assert.equal(result.status, 0);
  assert.equal(result.failure, 'resolve');
  console.log('PASS nothing reachable → structured failure');
}

// 8. A node that never answers is cut off after the header timeout, then the alternate is used.
{
  const impl = (async (input: any, init?: any) => {
    const url = String(input);
    if (url.startsWith('https://archive.org/download/')) return new Response(null, { status: 302, headers: { location: NODE } });
    if (url.startsWith('https://dn721905.ca.archive.org/')) {
      return new Promise<Response>((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    }
    if (url.startsWith('https://archive.org/metadata/')) return Response.json({ dir: '/0/items/nova-wonders', server: 'dn600306.us.archive.org' });
    return new Response('media-bytes', { status: 206, headers: { 'content-type': 'video/mp4' } });
  }) as FetchImpl;
  const started = Date.now();
  const result = await fetchArchiveMediaWithRetry(DOWNLOAD, { headers, fetchImpl: impl, sleep: noSleep, log, headerTimeoutMs: 60 });
  assert.equal(result.status, 206);
  assert.ok(Date.now() - started < 2000, 'hung node does not stall the request');
  console.log('PASS hung node → timed out, alternate used');
}

// 9. Client disconnect during a hung node is surfaced as an abort, not turned into a fallback.
{
  const controller = new AbortController();
  const impl = (async (input: any, init?: any) => {
    const url = String(input);
    if (url.startsWith('https://archive.org/download/')) { queueMicrotask(() => controller.abort()); return new Promise<Response>((_r, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })); }
    throw new Error(`unexpected fetch ${url}`);
  }) as FetchImpl;
  await assert.rejects(fetchArchiveMediaWithRetry(DOWNLOAD, { headers, fetchImpl: impl, sleep: noSleep, log, signal: controller.signal }));
  console.log('PASS client abort → not retried on alternates');
}

// 10. A duplicate concurrent request shares only the 1-byte redirect probe, not the media body.
{
  resetArchiveFetchStateForTests();
  const calls: { url: string; range: string | null }[] = [];
  const impl = (async (input: any, init?: any) => {
    const url = String(input);
    const range = new Headers(init?.headers).get('range');
    calls.push({ url, range });
    if (url.startsWith('https://archive.org/download/')) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return new Response(null, { status: 302, headers: { location: NODE } });
    }
    return new Response('media-bytes', { status: 206, headers: { 'content-type': 'audio/mpeg' } });
  }) as FetchImpl;
  const results = await Promise.all([
    fetchArchiveMediaWithRetry(DOWNLOAD, { headers, fetchImpl: impl, attempts: 1, sleep: noSleep, log }),
    fetchArchiveMediaWithRetry(DOWNLOAD, { headers, fetchImpl: impl, attempts: 1, sleep: noSleep, log }),
  ]);
  assert.ok(results.every((result) => result.status === 206));
  assert.equal(
    calls.filter((call) => call.range === 'bytes=0-0' && call.url.startsWith('https://archive.org/download/')).length,
    1,
    'one shared initial redirect request',
  );
  assert.equal(
    calls.filter((call) => call.range === 'bytes=0-0' && call.url.startsWith('https://dn721905.ca.archive.org/')).length,
    1,
    'one shared storage-node probe after redirect',
  );
  assert.equal(calls.filter((call) => call.range === 'bytes=0-10').length, 2, 'each caller gets its own media response');
  console.log('PASS duplicate requests → one resolution probe, two independent media responses');
}

// 11. Repeated timeouts on one item do not open a host-wide circuit; three distinct items do.
{
  resetArchiveFetchStateForTests();
  let calls = 0;
  const impl = (async () => {
    calls += 1;
    const cause = Object.assign(new Error('connect timeout'), { code: 'UND_ERR_CONNECT_TIMEOUT' });
    const error = new TypeError('fetch failed') as TypeError & { cause?: unknown };
    error.cause = cause;
    throw error;
  }) as FetchImpl;
  const result = await fetchArchiveMediaWithRetry(DOWNLOAD, {
    headers, fetchImpl: impl, attempts: 3, sleep: noSleep, log,
  });
  assert.equal(result.attempts, 3);
  assert.equal(result.errorCode, 'UND_ERR_CONNECT_TIMEOUT');
  assert.equal(calls, 3);
  assert.equal(archiveHostCircuitBreaker.canRequest('archive.org'), true, 'three failures for one item do not block unrelated items');
  for (const id of ['brother-bear', 'third-item']) {
    const other = await fetchArchiveMediaWithRetry(`https://archive.org/download/${id}/file.mp4`, {
      headers, fetchImpl: impl, attempts: 1, sleep: noSleep, log,
    });
    assert.equal(other.errorCode, 'UND_ERR_CONNECT_TIMEOUT');
  }
  assert.equal(calls, 5);
  assert.equal(archiveHostCircuitBreaker.canRequest('archive.org'), false, 'three distinct item failures open the host circuit');
  const opened = await fetchArchiveMediaWithRetry(DOWNLOAD, {
    headers, fetchImpl: impl, attempts: 3, sleep: noSleep, log,
  });
  assert.equal(opened.errorCode, 'AJN_UPSTREAM_CIRCUIT_OPEN');
  assert.equal(opened.attempts, 0);
  assert.equal(calls, 5, 'open circuit performs no new upstream request');
  assert.equal(NODE_HEADER_TIMEOUT_MS, 25_000);
  assert.equal(ARCHIVE_HEADER_WAIT_BUDGET_MS, 60_000);
  console.log('PASS one item stays isolated; 3 distinct timed-out items open the host circuit');
}

// 12. The total header budget bounds all retry/redirect header waits to 60 seconds.
{
  resetArchiveFetchStateForTests();
  let fakeNow = 0;
  const budget = createHeaderWaitBudget(60_000, () => fakeNow);
  assert.equal(budget(), 60_000);
  fakeNow += 25_000;
  assert.equal(budget(), 35_000);
  fakeNow += 25_000;
  assert.equal(budget(), 10_000);
  fakeNow += 10_000;
  assert.equal(budget(), 0);
  resetArchiveFetchStateForTests();
  let simulatedNow = 0;
  let stagedCalls = 0;
  const stagedFetch = (async (input: any) => {
    stagedCalls += 1;
    simulatedNow += 20;
    if (String(input).startsWith('https://archive.org/download/')) {
      return new Response(null, {
        status: 302,
        headers: { location: 'https://ia800.us.archive.org/download/slow-budget-item/file.mp4' },
      });
    }
    return new Response(null, { status: 503 });
  }) as FetchImpl;
  const acrossStages = await fetchArchiveMediaWithRetry('https://archive.org/download/slow-budget-item/file.mp4', {
    headers,
    attempts: 3,
    totalHeaderWaitMs: 30,
    headerBudgetNow: () => simulatedNow,
    fetchImpl: stagedFetch,
    sleep: noSleep,
    log,
  });
  assert.equal(acrossStages.errorCode, 'AJN_PROXY_HEADER_BUDGET_EXHAUSTED');
  assert.equal(stagedCalls, 2, 'shared deadline spans redirect probe and media response, then prevents another attempt');

  resetArchiveFetchStateForTests();
  const reply = await fetchArchiveMediaWithRetry(DOWNLOAD, {
    headers,
    attempts: 3,
    headerTimeoutMs: 25_000,
    totalHeaderWaitMs: 30,
    fetchImpl: (async (_input: any, init?: any) => new Promise<Response>((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('stub fetch aborted')), { once: true });
    })) as FetchImpl,
    sleep: noSleep,
    log,
  });
  assert.equal(reply.errorCode, 'AJN_PROXY_HEADER_BUDGET_EXHAUSTED');
  console.log('PASS total response-header wait budget stops at 60 s (short-budget abort tested offline)');
}

// 13. An open storage-node circuit is bypassed through another public replica.
{
  resetArchiveFetchStateForTests();
  const failedReplica = 'dn721905.ca.archive.org';
  const healthyReplica = 'dn721906.ca.archive.org';
  for (const id of ['one', 'two', 'three']) archiveHostCircuitBreaker.recordTimeout(failedReplica, id);
  const calls: string[] = [];
  const impl = (async (input: any) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith('https://archive.org/download/')) {
      return new Response(null, { status: 302, headers: { location: NODE } });
    }
    if (url.startsWith('https://archive.org/metadata/')) {
      return new Response(JSON.stringify({
        dir: '/0/items/nova-wonders',
        server: failedReplica,
        d1: healthyReplica,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.startsWith(`https://${healthyReplica}/`)) {
      return new Response('media-bytes', { status: 206, headers: { 'content-type': 'audio/mpeg' } });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as FetchImpl;
  const result = await fetchArchiveMediaWithRetry(DOWNLOAD, { headers, fetchImpl: impl, attempts: 3, sleep: noSleep, log });
  assert.equal(result.status, 206);
  assert.equal(calls.filter((url) => url.startsWith(`https://${failedReplica}/`)).length, 0);
  assert.equal(calls.filter((url) => url.startsWith('https://archive.org/metadata/')).length, 1);
  assert.equal(calls.filter((url) => url.startsWith(`https://${healthyReplica}/`)).length, 1);
  console.log('PASS open storage-node circuit → one metadata lookup, healthy replica served');
}

// 13. Client disconnect remains wired after headers so the streamed media fetch aborts.
{
  resetArchiveFetchStateForTests();
  const parent = new AbortController();
  let mediaSignal: AbortSignal | undefined;
  const impl = (async (input: any, init?: any) => {
    const url = String(input);
    const range = new Headers(init?.headers).get('range');
    if (url.startsWith('https://archive.org/download/')) {
      return new Response(null, { status: 302, headers: { location: NODE } });
    }
    if (range === 'bytes=0-0') return new Response(null, { status: 206 });
    mediaSignal = init?.signal;
    return new Response('streamed media', { status: 206, headers: { 'content-type': 'audio/mpeg' } });
  }) as FetchImpl;
  const result = await fetchArchiveMediaWithRetry(DOWNLOAD, {
    headers, fetchImpl: impl, attempts: 1, sleep: noSleep, log, signal: parent.signal,
  });
  assert.equal(result.status, 206);
  assert.ok(mediaSignal);
  assert.equal(mediaSignal!.aborted, false);
  parent.abort();
  assert.equal(mediaSignal!.aborted, true, 'disconnect after headers still aborts the upstream stream');
  console.log('PASS client abort after headers → streamed upstream request signal aborts');
}

class FakeCooldownClock implements ArchiveCooldownTimers {
  nowMs = 1_800_000_000_000;
  private nextId = 1;
  private jobs = new Map<number, { at: number; callback: () => void }>();

  now = (): number => this.nowMs;
  setTimeout(callback: () => void, ms: number): number {
    const id = this.nextId++;
    this.jobs.set(id, { at: this.nowMs + ms, callback });
    return id;
  }
  clearTimeout(handle: unknown): void { this.jobs.delete(Number(handle)); }
  advance(ms: number): void {
    this.nowMs += ms;
    const ready = [...this.jobs.entries()].filter(([, job]) => job.at <= this.nowMs).sort((a, b) => a[1].at - b[1].at);
    for (const [id, job] of ready) {
      this.jobs.delete(id);
      job.callback();
    }
  }
  get pendingTimers(): number { return this.jobs.size; }
}

const flushMicrotasks = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve)); // main shares resolve flights, which adds async hops
};

function retryAfterScript(header: string | null, mediaResponses: number[]) {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const range = new Headers(init?.headers).get('range');
    if (url.startsWith('https://archive.org/download/')) {
      return new Response(null, { status: 302, headers: { location: NODE } });
    }
    if (url === NODE && range === 'bytes=0-0') return new Response(null, { status: 200 });
    assert.equal(url, NODE, `unexpected test fetch ${url}`);
    const status = mediaResponses.shift();
    assert.ok(status, 'unexpected extra media request');
    return new Response(status === 206 ? 'synthetic-media' : 'synthetic-throttle', {
      status,
      headers: {
        ...(status === 206 ? { 'content-range': 'bytes 0-10/100', 'content-type': 'video/mp4' } : {}),
        ...(header ? { 'retry-after': header } : {}),
      },
    });
  }) as FetchImpl;
  return { impl, calls };
}

// 10. Delta-seconds Retry-After is awaited exactly, then the retry succeeds.
{
  resetArchiveFetchStateForTests();
  const clock = new FakeCooldownClock();
  const store = new ArchiveCooldownStore({ now: clock.now, timers: clock });
  const { impl } = retryAfterScript('2', [429, 206]);
  const promise = fetchArchiveMediaWithRetry(DOWNLOAD, {
    headers, fetchImpl: impl, attempts: 2, cooldownStore: store, now: clock.now,
    log: () => {}, sleep: noSleep,
  });
  await flushMicrotasks();
  assert.equal(store.remainingMs('dn721905.ca.archive.org'), 2000);
  assert.equal(clock.pendingTimers, 1);
  clock.advance(1999);
  await flushMicrotasks();
  assert.equal(store.remainingMs('dn721905.ca.archive.org'), 1);
  clock.advance(1);
  const result = await promise;
  assert.equal(result.status, 206);
  assert.equal(result.attempts, 2);
  assert.equal(result.failure, undefined);
  console.log('PASS Retry-After: 2 → one shared 2000 ms wait, then 206');
}

// 11. An excessive Retry-After returns an explicit rate-limit result without waiting.
{
  resetArchiveFetchStateForTests();
  const clock = new FakeCooldownClock();
  const store = new ArchiveCooldownStore({ now: clock.now, timers: clock });
  const { impl } = retryAfterScript('120', [429]);
  const started = Date.now();
  const result = await fetchArchiveMediaWithRetry(DOWNLOAD, {
    headers, fetchImpl: impl, cooldownStore: store, now: clock.now, log: () => {}, sleep: noSleep,
  });
  assert.ok(Date.now() - started < 500, 'the 120-second response must not wait');
  assert.deepEqual(result.rateLimit, { status: 429, retryAfterSeconds: 120 });
  assert.equal(result.failure, 'rate-limit');
  assert.equal(result.attempts, 1);
  assert.deepEqual(
    buildArchiveRateLimitHttpResponse(result.rateLimit!, result.attempts, 'synthetic-request-id'),
    {
      status: 429,
      retryAfterHeader: '120',
      body: {
        error: 'Archive is rate-limiting',
        retryAfterSeconds: 120,
        attempts: 1,
        proxyRequestId: 'synthetic-request-id',
      },
    },
  );
  console.log('PASS Retry-After: 120 → explicit 429 rate-limit result, immediate, 1 attempt');
}

// 12. HTTP-date form is parsed against the injected clock and used as the shared delay.
{
  resetArchiveFetchStateForTests();
  const clock = new FakeCooldownClock();
  const exactSecond = Math.floor(clock.nowMs / 1000) * 1000;
  clock.nowMs = exactSecond;
  const header = new Date(exactSecond + 5000).toUTCString();
  assert.equal(parseRetryAfter(header, exactSecond), 5000);
  const store = new ArchiveCooldownStore({ now: clock.now, timers: clock });
  const { impl } = retryAfterScript(header, [503, 206]);
  const promise = fetchArchiveMediaWithRetry(DOWNLOAD, {
    headers, fetchImpl: impl, attempts: 2, cooldownStore: store, now: clock.now,
    log: () => {}, sleep: noSleep,
  });
  await flushMicrotasks();
  assert.equal(store.remainingMs('dn721905.ca.archive.org'), 5000);
  clock.advance(5000);
  const result = await promise;
  assert.equal(result.status, 206);
  assert.equal(result.attempts, 2);
  console.log('PASS Retry-After HTTP-date → correct 5000 ms cooldown');
}

// 13. Missing Retry-After retains the existing exponential 400 ms backoff.
{
  resetArchiveFetchStateForTests();
  const { impl } = retryAfterScript(null, [429, 206]);
  const waits: number[] = [];
  const result = await fetchArchiveMediaWithRetry(DOWNLOAD, {
    headers, fetchImpl: impl, attempts: 2, log: () => {},
    sleep: async (ms) => { waits.push(ms); },
  });
  assert.equal(result.status, 206);
  assert.deepEqual(waits, [400]);
  console.log('PASS missing Retry-After → existing 400 ms backoff');
}

// 14. Client abort during Retry-After wait rejects immediately and does not retry.
{
  resetArchiveFetchStateForTests();
  const clock = new FakeCooldownClock();
  const store = new ArchiveCooldownStore({ now: clock.now, timers: clock });
  const controller = new AbortController();
  const { impl } = retryAfterScript('2', [429, 206]);
  const promise = fetchArchiveMediaWithRetry(DOWNLOAD, {
    headers, fetchImpl: impl, attempts: 2, cooldownStore: store, now: clock.now,
    log: () => {}, sleep: noSleep, signal: controller.signal,
  });
  await flushMicrotasks();
  assert.equal(store.timerCount, 1);
  controller.abort();
  await assert.rejects(promise, (error: unknown) => error instanceof Error && error.name === 'AbortError');
  assert.equal(store.timerCount, 1, 'one shared cooldown timer remains for other callers despite this caller aborting');
  store.clear();
  console.log('PASS abort during Retry-After → caller stops, shared host timer remains');
}

// 15. Two requests for one storage host await one cooldown timer rather than sleeping independently.
{
  resetArchiveFetchStateForTests();
  const clock = new FakeCooldownClock();
  const store = new ArchiveCooldownStore({ now: clock.now, timers: clock });
  const makeRequest = () => {
    const { impl } = retryAfterScript('2', [429, 206]);
    return fetchArchiveMediaWithRetry(DOWNLOAD, {
      headers, fetchImpl: impl, attempts: 2, cooldownStore: store, now: clock.now,
      log: () => {}, sleep: noSleep,
    });
  };
  const first = makeRequest();
  const second = makeRequest();
  await flushMicrotasks();
  assert.equal(store.timerCount, 1, 'both requests share a single timer for the host');
  assert.equal(clock.pendingTimers, 1);
  clock.advance(2000);
  const results = await Promise.all([first, second]);
  assert.ok(results.every((result) => result.status === 206 && result.attempts === 2));
  assert.equal(store.timerCount, 0);
  console.log('PASS concurrent Retry-After requests → shared 1 timer; both retry only after cooldown');
}

// 16. One real-time wait uses only the stubbed FetchImpl; no network reaches Archive.
{
  resetArchiveFetchStateForTests();
  const store = new ArchiveCooldownStore();
  const { impl } = retryAfterScript('2', [429, 206]);
  const started = Date.now();
  const result = await fetchArchiveMediaWithRetry(DOWNLOAD, {
    headers, fetchImpl: impl, attempts: 2, cooldownStore: store, log: () => {}, sleep: noSleep,
  });
  const elapsed = Date.now() - started;
  assert.equal(result.status, 206);
  assert.ok(elapsed >= 1900 && elapsed < 5000, `expected ~2 s Retry-After wait, got ${elapsed} ms`);
  assert.equal(store.timerCount, 0);
  console.log(`PASS real-time Retry-After: 2 → 206 after ${elapsed} ms (stubbed FetchImpl; 0 Archive requests)`);
}

// 17. The shared API limiter refuses a host still in a long cooldown before fetch.
{
  resetArchiveFetchStateForTests();
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  sharedArchiveCooldownStore.extend('archive.org', 120_000);
  globalThis.fetch = (async () => {
    fetchCalled = true;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  try {
    await assert.rejects(
      archiveApiFetch('https://archive.org/advancedsearch.php?q=synthetic'),
      (error: unknown) => error instanceof ArchiveRateLimitError && error.retryAfterSeconds === 120,
    );
    assert.equal(fetchCalled, false, 'API limiter does not dispatch during a host cooldown');
  } finally {
    globalThis.fetch = originalFetch;
    sharedArchiveCooldownStore.clear();
  }
  console.log('PASS shared API limiter → long Archive host cooldown blocks dispatch before fetch');
}

console.log('archive retry regression: all passed');
