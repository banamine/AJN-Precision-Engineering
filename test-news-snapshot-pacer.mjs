import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPacedArchiveFetch, NEWS_SNAPSHOT_MIN_GAP_MS } from './tools/newsSnapshotPacer.mjs';

test('every redirect hop is separately serialized at the 1.5 second floor', async () => {
  let now = 10_000;
  const starts = [];
  const paced = createPacedArchiveFetch({
    now: () => now,
    sleep: async (ms) => { now += ms; },
    fetchImpl: async (url) => {
      starts.push({ url: String(url), at: now });
      if (starts.length === 1) return new Response(null, { status: 302, headers: { location: '/redirected' } });
      return new Response('ok', { status: 200 });
    },
  });
  const response = await paced('https://archive.org/start');
  assert.equal(response.status, 200);
  assert.equal(starts.length, 2);
  assert.deepEqual(starts.map((item) => new URL(item.url).pathname), ['/start', '/redirected']);
  assert.ok(starts[1].at - starts[0].at >= NEWS_SNAPSHOT_MIN_GAP_MS);
});

test('Retry-After is honored before the next physical request', async () => {
  let now = 5_000;
  const starts = [];
  const paced = createPacedArchiveFetch({
    now: () => now,
    sleep: async (ms) => { now += ms; },
    fetchImpl: async () => {
      starts.push(now);
      return starts.length === 1
        ? new Response('slow down', { status: 429, headers: { 'retry-after': '4' } })
        : new Response('ok', { status: 200 });
    },
  });
  assert.equal((await paced('https://archive.org/a')).status, 429);
  assert.equal((await paced('https://archive.org/b')).status, 200);
  assert.ok(starts[1] - starts[0] >= 4_000);
});
