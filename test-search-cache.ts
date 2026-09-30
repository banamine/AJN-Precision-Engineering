// Offline contract test for the searchTVNews result cache (channels.ts).
// No network: global fetch is stubbed. Each scenario uses its own network name so the
// module-level cache cannot leak between scenarios.
//
//   upstream_error -> NOT cached: an immediate retry reaches Archive again.
//   ok / empty     -> cached:     a repeat call does not reach Archive.
//   in flight      -> shared:     concurrent identical calls make one upstream search.
import assert from 'node:assert/strict';
import { searchTVNews } from './channels.ts';

type Mode = 'fail' | 'ok' | 'empty';
let mode: Mode = 'fail';
let calls = 0;

const realFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  calls++;
  if (mode === 'fail') return new Response('unavailable', { status: 503 });
  const docs = mode === 'ok'
    ? [{ identifier: 'CNNW_20260928_080000_CNN_Newsroom_Live', title: 'CNN Newsroom Live' }]
    : [];
  return new Response(JSON.stringify({ response: { numFound: docs.length, docs } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}) as typeof fetch;

// Silence the channel module's diagnostic logging for a readable test log.
const realLog = console.log, realWarn = console.warn, realError = console.error;
console.log = console.warn = console.error = () => {};

async function delta(run: () => Promise<unknown>): Promise<number> {
  const before = calls;
  await run();
  return calls - before;
}

try {
  // A. upstream_error is not cached.
  mode = 'fail';
  const a1 = await searchTVNews({ network: 'CACHE_A', rows: 5 });
  assert.equal(a1.status, 'upstream_error', 'A: failing Archive must resolve upstream_error');
  const retry = await delta(async () => {
    const a2 = await searchTVNews({ network: 'CACHE_A', rows: 5 });
    assert.equal(a2.status, 'upstream_error');
  });
  assert.ok(retry > 0, 'A: immediate retry after upstream_error must reach Archive again');

  // B. Recovery is visible immediately, and the ok result is then cached.
  mode = 'ok';
  const b1 = await searchTVNews({ network: 'CACHE_A', rows: 5 });
  assert.equal(b1.status, 'ok', 'B: after recovery the same request must return ok, not the old failure');
  assert.equal(b1.items.length, 1);
  const repeat = await delta(async () => {
    const b2 = await searchTVNews({ network: 'CACHE_A', rows: 5 });
    assert.equal(b2, b1, 'B: ok result must be served from cache');
  });
  assert.equal(repeat, 0, 'B: cached ok result must not reach Archive');

  // C. A valid empty result is cached.
  mode = 'empty';
  const c1 = await searchTVNews({ network: 'CACHE_C', rows: 5 });
  assert.equal(c1.status, 'empty');
  const cRepeat = await delta(async () => {
    const c2 = await searchTVNews({ network: 'CACHE_C', rows: 5 });
    assert.equal(c2.status, 'empty');
  });
  assert.equal(cRepeat, 0, 'C: cached empty result must not reach Archive');

  // D. Concurrent identical requests share one in-flight search (ok: first collection answers).
  mode = 'ok';
  const dCalls = await delta(async () => {
    const [d1, d2] = await Promise.all([
      searchTVNews({ network: 'CACHE_D', rows: 5 }),
      searchTVNews({ network: 'CACHE_D', rows: 5 }),
    ]);
    assert.equal(d1, d2, 'D: concurrent callers must share one result');
  });
  assert.equal(dCalls, 1, 'D: concurrent identical searches must make exactly one upstream request');

  // E. Concurrent failures share one search, and the failure is not retained afterwards.
  mode = 'fail';
  const eShared = await delta(async () => {
    await Promise.all([
      searchTVNews({ network: 'CACHE_E', rows: 5 }),
      searchTVNews({ network: 'CACHE_E', rows: 5 }),
    ]);
  });
  assert.equal(eShared, 2, 'E: concurrent failing searches must share one search (two candidate probes)');
  mode = 'ok';
  const e3 = await searchTVNews({ network: 'CACHE_E', rows: 5 });
  assert.equal(e3.status, 'ok', 'E: request after the failure must retry and succeed');
} finally {
  globalThis.fetch = realFetch;
  console.log = realLog; console.warn = realWarn; console.error = realError;
}

console.log('search cache contract: all passed');
