import assert from 'node:assert/strict';
import {
  fetchArchiveMediaWithRetry,
  resetArchiveFetchStateForTests,
} from './server/archiveFetch.ts';
import { archiveApiFetch, resetArchiveLimiterForTests } from './server/archiveLimiter.ts';

const DOWNLOAD = 'https://archive.org/download/nker150-synthetic/sample.mp4';
const NODE = 'https://dn600306.us.archive.org/0/items/nker150-synthetic/sample.mp4';
const savedFetch = globalThis.fetch;
const savedGap = process.env.AJN_ARCHIVE_MIN_GAP_MS;
const savedAudit = process.env.AJN_NKER150_AUDIT_LEDGER;

function scriptedFetch(firstStatus: 500 | 429, retryAfter?: string) {
  const starts: number[] = [];
  const events: Array<{ attempt: number | null; stage: string | null; status: number; gapMs: number | null }> = [];
  let call = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    starts.push(Date.now());
    call += 1;
    const url = String(input);
    if (call === 1) {
      return new Response('temporary upstream error', {
        status: firstStatus,
        headers: retryAfter ? { 'retry-after': retryAfter } : {},
      });
    }
    if (call === 2) {
      assert.equal(url, DOWNLOAD);
      return new Response(null, { status: 302, headers: { location: NODE } });
    }
    assert.equal(url, NODE);
    return new Response('synthetic-bounded-slice', {
      status: 206,
      headers: { 'content-range': 'bytes 0-10/11', 'content-type': 'video/mp4' },
    });
  }) as typeof fetch;
  return { starts, events, get calls() { return call; } };
}

async function runCase(firstStatus: 500 | 429, retryAfter?: string) {
  await resetLimiter();
  resetArchiveFetchStateForTests();
  const fixture = scriptedFetch(firstStatus, retryAfter);
  const result = await fetchArchiveMediaWithRetry(DOWNLOAD, {
    headers: { Range: 'bytes=0-10', Accept: '*/*', 'User-Agent': 'AJN-NKER150-Pacing-Test' },
    requestId: `synthetic-${firstStatus}`,
    physicalContext: {
      onPhysicalRequest: (event) => fixture.events.push({
        attempt: event.attempt,
        stage: event.stage,
        status: event.status,
        gapMs: event.gapMs,
      }),
    },
  });
  assert.equal(result.status, 206);
  assert.equal(result.attempts, 2, 'the proxy owns the single retry sequence');
  assert.equal(fixture.calls, 4, 'one resolve failure, a redirect probe, then bounded media fetch');
  assert.deepEqual(fixture.events.map((event) => event.status), [firstStatus, 302, 206, 206]);
  assert.deepEqual(fixture.events.map((event) => event.attempt), [1, 2, 2, 2]);
  assert.ok(fixture.starts.slice(1).every((start, i) => start - fixture.starts[i] >= 1_500),
    `every physical request start must be at least 1500 ms apart: ${fixture.starts.join(',')}`);
  if (retryAfter) {
    assert.ok(fixture.starts[1] - fixture.starts[0] >= 2_000,
      `Retry-After must not be shortened: got ${fixture.starts[1] - fixture.starts[0]} ms`);
  }
  assert.ok(fixture.events[1].stage === 'resolve' && fixture.events[2].stage === 'resolve');
  assert.equal(fixture.events[3].stage, 'media');
  return fixture.starts.map((start, i) => i === 0 ? null : start - fixture.starts[i - 1]);
}

async function resetLimiter() {
  resetArchiveLimiterForTests();
}

async function runNormalModeCase() {
  await resetLimiter();
  delete process.env.AJN_NKER150_AUDIT_LEDGER;
  const starts: number[] = [];
  globalThis.fetch = (async () => {
    starts.push(Date.now());
    return new Response('ok', { status: 200 });
  }) as typeof fetch;
  await Promise.all([
    archiveApiFetch('https://archive.org/metadata/normal-a'),
    archiveApiFetch('https://archive.org/metadata/normal-b'),
  ]);
  const gap = starts[1] - starts[0];
  assert.ok(gap >= 120, `normal Archive API requests keep the 120 ms floor: ${gap} ms`);
  return gap;
}

try {
  process.env.AJN_ARCHIVE_MIN_GAP_MS = '120'; // an environment setting may lengthen the floor, never reduce it
  const normalGap = await runNormalModeCase();
  console.log(`PASS normal API pacing gap ${normalGap} ms (120 ms floor, synthetic, 0 Archive requests)`);
  const fiveHundredGaps = await runCase(500);
  console.log(`PASS 500 retry path gaps with configured 120 ms: ${fiveHundredGaps.slice(1).join(',')} ms (synthetic, 0 Archive requests)`);
  const retryAfterGaps = await runCase(429, '2');
  console.log(`PASS 429 Retry-After path gaps with configured 120 ms: ${retryAfterGaps.slice(1).join(',')} ms (synthetic, 0 Archive requests)`);
} finally {
  globalThis.fetch = savedFetch;
  if (savedGap === undefined) delete process.env.AJN_ARCHIVE_MIN_GAP_MS;
  else process.env.AJN_ARCHIVE_MIN_GAP_MS = savedGap;
  if (savedAudit === undefined) delete process.env.AJN_NKER150_AUDIT_LEDGER;
  else process.env.AJN_NKER150_AUDIT_LEDGER = savedAudit;
  await new Promise<void>((resolve) => setImmediate(resolve));
  resetArchiveLimiterForTests();
}
