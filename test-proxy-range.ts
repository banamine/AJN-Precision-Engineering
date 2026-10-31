import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { proxySliceRange, PROXY_SLICE_BYTES as S } from './server/proxyRange.ts';
import { buildArchiveProxyUrl } from './src/utils/archivePlayback.ts';
import { archiveProxyContentType } from './server/archiveMediaTypes.ts';
import { isReadAheadMediaPath } from './server/sliceReadAhead.ts';
import { readFileSync as readText } from 'node:fs';

assert.equal(S, 8 * 1024 * 1024, 'proxy slice cap must be 8 MiB');
assert.ok(S <= 32 * 1024 * 1024, 'proxy slice cap must never exceed 32 MiB');
assert.equal(archiveProxyContentType('/download/id/file.m4a', 'application/octet-stream'), 'audio/mp4');
assert.equal(archiveProxyContentType('/download/id/file.aac', 'application/octet-stream'), 'audio/aac');
assert.equal(archiveProxyContentType('/download/id/file.mp3', 'application/octet-stream'), 'application/octet-stream');
assert.equal(archiveProxyContentType('/download/id/file.m4a', 'audio/m4a'), 'audio/m4a', 'do not override a real upstream type');
assert.equal(isReadAheadMediaPath('/download/id/file.mp4?exact=1&start=0&end=282'), true);
assert.equal(isReadAheadMediaPath('/download/id/file%3Fpart.mp4'), true);

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
const pathHelperSource = readText(new URL('./server/archivePathEncoding.ts', import.meta.url), 'utf8');
for (const required of [
  "if (!raw.startsWith('/'))",
  "raw.startsWith('/api/archive/proxy')",
  "raw.includes('://')",
  "!archivePath.startsWith('/download/')",
  "decoded.includes('/') || decoded.includes('\\\\')",
]) {
  assert.ok(pathHelperSource.includes(required), `Archive proxy SSRF/path guard source text missing: ${required}`);
}
assert.ok(serverSource.includes('toArchiveUpstreamUrl(v.cleanPath)'), 'proxy upstream URL must use canonical URL builder');

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
  /upstreamHeaders\.Range\s*=\s*`bytes=\$\{(?:slice|mediaSlice)\.start\}-\$\{(?:slice|mediaSlice)\.end\}`/.test(serverSource),
  'Archive proxy bounded upstream Range assignment missing',
);

console.log('proxy hardening contract source guards: structural source checks passed; not behavior tests');
