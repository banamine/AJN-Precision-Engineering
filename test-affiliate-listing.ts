import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';
import {
  AFFILIATE_LISTING_MAX_BYTES,
  AFFILIATE_LISTING_URL,
  registerAffiliateListingRoute,
} from './server/routes/affiliateListing.ts';

const validHtml = Buffer.from('<html><body><a href="/affiliates/mp4-segs/episode.mp4">episode</a></body></html>');

async function serve(
  fetchImpl: typeof fetch,
  options: { cacheFile: string; now: () => number; timeoutMs?: number },
): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  registerAffiliateListingRoute(app, { ...options, fetchImpl });
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}/api/affiliate-listing`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function mockResponse(body: Buffer | string, status = 200): Response {
  const responseBody = typeof body === 'string' ? body : new Uint8Array(body);
  return new Response(responseBody, { status, headers: { 'content-type': 'text/html' } });
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'affiliate-listing-test-'));
try {
  {
    const cacheFile = path.join(tempRoot, 'success', 'cache.json');
    const time = 1_800_000_000_000;
    let calls = 0;
    let observedInit: RequestInit | undefined;
    const app = await serve(async (input, init) => {
      calls++;
      assert.equal(String(input), AFFILIATE_LISTING_URL, 'upstream destination is fixed');
      observedInit = init;
      return mockResponse(validHtml);
    }, { cacheFile, now: () => time });
    try {
      const response = await fetch(`${app.url}?url=https%3A%2F%2Fexample.invalid%2F`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
      assert.equal(response.headers.get('x-listing-source'), 'live');
      assert.equal(response.headers.get('x-listing-fetched-at'), new Date(time).toISOString());
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), validHtml, 'HTML response bytes are unchanged');
      assert.deepEqual(observedInit?.headers, { accept: 'text/html' }, 'only the HTML Accept header is set; no custom User-Agent');
      assert.equal(observedInit?.redirect, 'error');
      const cached = await fetch(app.url);
      assert.equal(cached.headers.get('x-listing-source'), 'live');
      assert.equal(calls, 1, 'fresh in-memory cache avoids another upstream request');
      console.log('PASS live response is byte-preserving, fixed-host, bounded-header, and fresh-cache aware');
    } finally {
      await app.close();
    }
  }

  {
    let calls = 0;
    const app = await serve(async () => {
      calls++;
      return mockResponse('<html><title>Just a moment...</title><script>cf-chl</script></html>');
    }, { cacheFile: path.join(tempRoot, 'challenge', 'cache.json'), now: () => 1_800_000_100_000 });
    try {
      const response = await fetch(app.url);
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { error: 'upstream_unavailable', detail: 'cloudflare_challenge' });
      assert.equal(calls, 1);
      console.log('PASS Cloudflare challenge page fails closed');
    } finally {
      await app.close();
    }
  }

  {
    const app = await serve(async () => new Promise<Response>(() => {}), {
      cacheFile: path.join(tempRoot, 'timeout', 'cache.json'),
      now: () => 1_800_000_200_000,
      timeoutMs: 10,
    });
    try {
      const response = await fetch(app.url);
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { error: 'upstream_unavailable', detail: 'timeout' });
      console.log('PASS upstream timeout returns a bounded failure');
    } finally {
      await app.close();
    }
  }

  {
    const cacheFile = path.join(tempRoot, 'stale', 'cache.json');
    let time = 1_800_000_300_000;
    let call = 0;
    const fetchImpl: typeof fetch = async () => {
      call++;
      return call === 1 ? mockResponse(validHtml) : mockResponse('upstream unavailable', 503);
    };
    const first = await serve(fetchImpl, { cacheFile, now: () => time });
    try {
      assert.equal((await fetch(first.url)).status, 200);
    } finally {
      await first.close();
    }
    time += 12 * 60 * 1000;
    const restarted = await serve(fetchImpl, { cacheFile, now: () => time });
    try {
      const response = await fetch(restarted.url);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-listing-source'), 'stale');
      assert.equal(response.headers.get('x-listing-age-seconds'), String(12 * 60));
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), validHtml);
      console.log('PASS disk-backed last-good listing is served as stale with age');
    } finally {
      await restarted.close();
    }
  }

  {
    const cacheFile = path.join(tempRoot, 'too-stale', 'cache.json');
    let time = 1_800_000_400_000;
    let call = 0;
    const fetchImpl: typeof fetch = async () => {
      call++;
      return call === 1 ? mockResponse(validHtml) : mockResponse('upstream unavailable', 503);
    };
    const first = await serve(fetchImpl, { cacheFile, now: () => time });
    try {
      assert.equal((await fetch(first.url)).status, 200);
    } finally {
      await first.close();
    }
    time += 36 * 60 * 60 * 1000 + 1;
    const restarted = await serve(fetchImpl, { cacheFile, now: () => time });
    try {
      const response = await fetch(restarted.url);
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { error: 'upstream_unavailable', detail: 'upstream_http_503' });
      console.log('PASS cache older than 36 hours is not served');
    } finally {
      await restarted.close();
    }
  }

  {
    const tooLarge = Buffer.alloc(AFFILIATE_LISTING_MAX_BYTES + 1, 0x61);
    const app = await serve(async () => mockResponse(tooLarge), {
      cacheFile: path.join(tempRoot, 'oversize', 'cache.json'),
      now: () => 1_800_000_500_000,
    });
    try {
      const response = await fetch(app.url);
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { error: 'upstream_unavailable', detail: 'source_too_large' });
      console.log('PASS response bodies over 2 MiB are rejected');
    } finally {
      await app.close();
    }
  }
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log('AFFILIATE_LISTING_TESTS_PASS cases=6');
