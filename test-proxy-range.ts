import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { proxySliceRange, PROXY_SLICE_BYTES as S } from './server/proxyRange.ts';
import { buildArchiveProxyUrl } from './src/utils/archivePlayback.ts';

assert.equal(S, 8 * 1024 * 1024, 'proxy slice cap must be 8 MiB');
assert.ok(S <= 32 * 1024 * 1024, 'proxy slice cap must never exceed 32 MiB');

assert.deepEqual(proxySliceRange('bytes=0-'), { start: 0, end: S - 1 });
assert.deepEqual(proxySliceRange(undefined), { start: 0, end: S - 1 });
assert.deepEqual(proxySliceRange('bytes=0-1023'), { start: 0, end: 1023 });
assert.deepEqual(proxySliceRange('bytes=100000000-'), { start: 100000000, end: 100000000 + S - 1 });
assert.deepEqual(proxySliceRange('bytes=5-999999999'), { start: 5, end: 5 + S - 1 });
assert.deepEqual(proxySliceRange('bytes=0-33554431'), { start: 0, end: S - 1 });

const multiSegmentPath = '/download/collection/season 01/episode 01.mp4?start=0&end=300';
const encoded = buildArchiveProxyUrl(multiSegmentPath);
assert.equal(
  encoded,
  `/api/archive/proxy?path=${encodeURIComponent(multiSegmentPath)}`,
  'multi-segment Archive paths must be encoded as one proxy path value',
);

const serverSource = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');

for (const required of [
  "if(!raw.startsWith('/'))",
  "if(raw.startsWith('/api/archive/proxy'))",
  "if(/^https?:\\/\\//i.test(raw)||raw.includes('://'))",
  "else if (!raw.startsWith('/download/'))",
]) {
  assert.ok(serverSource.includes(required), `Archive proxy SSRF/path guard source text missing: ${required}`);
}

for (const header of ['Content-Range', 'Content-Length', 'Accept-Ranges', 'ETag']) {
  assert.ok(
    serverSource.includes(header),
    `Archive proxy header source text missing: ${header}`,
  );
}
assert.ok(
  serverSource.includes("res.setHeader('Accept-Ranges',acceptRanges || 'bytes')"),
  'Archive proxy Accept-Ranges forwarding source text missing',
);
assert.ok(
  serverSource.includes("res.setHeader('ETag',etag)"),
  'Archive proxy ETag forwarding source text missing',
);
assert.ok(
  serverSource.includes("res.on('close',()=>{ if(!res.writableFinished) upstreamAbort.abort(); })"),
  'Archive proxy client-disconnect abort source text missing',
);
assert.ok(
  serverSource.includes("upstreamHeaders.Range=`bytes=${slice.start}-${slice.end}`"),
  'Archive proxy bounded upstream Range source text missing',
);

console.log('proxy hardening contract source guards: structural source checks passed; not behavior tests');
