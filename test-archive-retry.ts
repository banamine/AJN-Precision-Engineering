// Unit regression: Archive proxy retries transient upstream errors only.
import assert from 'node:assert/strict';
import {
  archiveHostCircuitBreaker,
  fetchArchiveMediaWithRetry,
  NODE_HEADER_TIMEOUT_MS,
  resetArchiveFetchStateForTests,
  type FetchImpl,
} from './server/archiveFetch.ts';

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

// 11. Three connect timeouts open a per-host circuit; the next request fails without another fetch.
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
  assert.equal(archiveHostCircuitBreaker.canRequest('archive.org'), false);
  const opened = await fetchArchiveMediaWithRetry(DOWNLOAD, {
    headers, fetchImpl: impl, attempts: 3, sleep: noSleep, log,
  });
  assert.equal(opened.errorCode, 'AJN_UPSTREAM_CIRCUIT_OPEN');
  assert.equal(opened.attempts, 0);
  assert.equal(calls, 3, 'open circuit performs no new upstream request');
  assert.ok(NODE_HEADER_TIMEOUT_MS <= 8_000);
  console.log('PASS three connect timeouts → host circuit opens; next request makes 0 fetches');
}

// 12. An open storage-node circuit is bypassed through another public replica.
{
  resetArchiveFetchStateForTests();
  const failedReplica = 'dn721905.ca.archive.org';
  const healthyReplica = 'dn721906.ca.archive.org';
  for (let i = 0; i < 3; i++) archiveHostCircuitBreaker.recordTimeout(failedReplica);
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

console.log('archive retry regression: all passed');
