import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { attachArchiveVideoPrefetch } from './src/utils/videoPrefetch.ts';

class LocalMedia {
  currentTime = 60;
  duration = 100;
  paused = false;
  ended = false;
  readyState = 4;
  listeners = new Map();
  addEventListener(type, listener) {
    const group = this.listeners.get(type) ?? new Set();
    group.add(listener);
    this.listeners.set(type, group);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  dispatch(type) { for (const listener of this.listeners.get(type) ?? []) listener(); }
}

const warmItems = new Set();
const requestLog = [];
const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const item = url.searchParams.get('path') ?? '';
  requestLog.push({ item, range: request.headers.range ?? null });
  const send = () => {
    warmItems.add(item);
    const body = Buffer.alloc(1024, 7);
    response.writeHead(206, {
      'Content-Type': 'video/mp4',
      'Content-Range': 'bytes 0-1023/10000',
      'Content-Length': String(body.length),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
    });
    response.end(body);
  };
  if (warmItems.has(item)) send();
  else setTimeout(send, 160); // synthetic cold proxy miss; no Archive host is contacted
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const base = `http://127.0.0.1:${address.port}`;

async function firstByteMs(url, init) {
  const started = performance.now();
  const response = await fetch(url, init);
  const elapsed = performance.now() - started;
  assert.equal(response.status, 206);
  await response.body?.cancel();
  return Math.round(elapsed);
}

try {
  const coldPath = '/api/archive/proxy?path=%2Fdownload%2Fsynthetic%2Fcold.mp4';
  const warmPath = '/api/archive/proxy?path=%2Fdownload%2Fsynthetic%2Fwarm.mp4';
  const rangeInit = { headers: { Range: 'bytes=0-1048575' } };
  const coldMs = await firstByteMs(new URL(coldPath, base), rangeInit);

  const media = new LocalMedia();
  const telemetry = [];
  const cleanup = attachArchiveVideoPrefetch({
    media,
    currentSrc: '/api/archive/proxy?path=%2Fdownload%2Fsynthetic%2Fcurrent.mp4',
    currentMediaType: 'video',
    currentGuideId: 'classic-tv',
    currentChannelId: 'synthetic-channel',
    currentProgramId: 'synthetic-current',
    resolveNext: async () => ({
      src: warmPath,
      mediaType: 'video',
      guideId: 'classic-tv',
      channelId: 'synthetic-channel',
      programId: 'synthetic-warm',
    }),
    fetcher: (input, init) => fetch(new URL(String(input), base), init),
    onTelemetry: (event) => telemetry.push(event),
  });
  media.dispatch('timeupdate');
  const deadline = Date.now() + 5_000;
  while (!telemetry.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(telemetry.length, 1);
  assert.equal(telemetry[0].outcome, 'completed');
  assert.equal(telemetry[0].bytes, 1024);
  const warmMs = await firstByteMs(new URL(warmPath, base), rangeInit);
  cleanup();

  const itemRequests = requestLog.filter((row) => row.item.includes('warm.mp4'));
  assert.equal(itemRequests.length, 2, 'one prefetch then one playback request use the local warm-cache stub');
  assert.ok(itemRequests.every((row) => row.range === 'bytes=0-1048575'));
  assert.ok(warmMs < coldMs, `warm first byte ${warmMs}ms must beat cold ${coldMs}ms`);
  console.log(JSON.stringify({
    syntheticLocalProxy: true,
    coldFirstByteMs: coldMs,
    warmFirstByteMs: warmMs,
    warmPathRequests: itemRequests.length,
    requestedRange: itemRequests[0].range,
    archiveRequests: 0,
  }));
  console.log('PASS video-prefetch local warm-cache timing (synthetic only; 0 Archive requests)');
} finally {
  await new Promise((resolve) => server.close(resolve));
}
