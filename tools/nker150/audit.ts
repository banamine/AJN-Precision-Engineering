import fs from 'node:fs';
import path from 'node:path';
import { appendPhysicalEvents, decodePhysicalEvents } from './ledger';

const TEST_IDENTIFIER = '01_20200728_20200728_1511';
const TEST_FILE = '20190101_Tue_Alex-HD.mp4';

function localBase(): URL {
  const url = new URL(process.env.AJN_TEST_URL ?? 'http://localhost:3110');
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error('AJN_TEST_URL must be a loopback server; audit.ts makes no direct Archive calls');
  }
  return url;
}

async function main() {
  const identifier = process.argv.find((arg) => arg.startsWith('--identifier='))?.split('=')[1] ?? TEST_IDENTIFIER;
  if (identifier !== TEST_IDENTIFIER) throw new Error('this resumed run is intentionally capped to the approved first test item');
  const base = localBase();
  const root = path.resolve('tools/nker150');
  const requestsPath = path.join(root, 'nker150_requests.csv');
  const requestId = `nker150-audit-${Date.now()}`;
  const proxyUrl = new URL('/api/archive/proxy', base);
  proxyUrl.searchParams.set('path', `/download/${identifier}/${TEST_FILE}`);

  let response: Response;
  try {
    response = await fetch(proxyUrl, {
      headers: {
        Range: 'bytes=0-',
        'User-Agent': 'AJN-NKER150-Audit/1.0 (local verification; no metadata refetch)',
        'X-Request-ID': requestId,
      },
    });
  } catch (error) {
    console.error(`proxy request failed before an HTTP response: ${(error as Error).message}`);
    process.exitCode = 2;
    return;
  }

  const events = decodePhysicalEvents(response.headers.get('x-ajn-archive-physical'));
  appendPhysicalEvents(requestsPath, `audit:${identifier}`, response.headers.get('x-proxy-request-id'), events);
  const contentType = response.headers.get('content-type') ?? '';
  const body = await response.arrayBuffer();
  const bytes = body.byteLength;
  // Deliberately discard the response body; the audit stores no media bytes.
  const result = {
    identifier,
    status: response.status,
    contentType,
    bytes,
    maxSliceBytes: 8_388_608,
    appAttempts: new Set(events.map((event) => event.attempt).filter((n): n is number => n !== null)).size,
    physicalStarts: events.length,
    requestLedger: requestsPath,
    retryAfterObserved: events.some((event) => Boolean(event.retryAfter)),
  };
  console.log(JSON.stringify(result));
  if (bytes > 8_388_608) throw new Error(`bounded response exceeded 8 MiB (${bytes} bytes)`);
  if (events.some((event) => event.status === 429 || event.status === 503) && response.status !== 206) {
    process.exitCode = 75;
  } else if (response.status !== 206 || !/^video\/mp4\b/i.test(contentType)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`audit failed: ${(error as Error).message}`);
  process.exitCode = 1;
});
