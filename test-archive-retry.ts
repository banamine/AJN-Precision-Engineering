// Unit regression: Archive proxy retries transient upstream errors only.
import assert from 'node:assert/strict';
import { fetchArchiveMediaWithRetry, type FetchImpl } from './server/archiveFetch.ts';

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
  const mediaCalls = calls.filter((c) => c.range !== null);
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

console.log('archive retry regression: all passed');
