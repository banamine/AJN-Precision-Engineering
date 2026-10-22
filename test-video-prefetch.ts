import assert from 'node:assert/strict';
import {
  attachArchiveVideoPrefetch,
  VIDEO_PREFETCH_MAX_BYTES,
  VIDEO_PREFETCH_PAUSE_CANCEL_MS,
  VIDEO_PREFETCH_RANGE,
  isArchiveProxyPath,
  type ArchiveVideoPrefetchOptions,
  type PrefetchMedia,
  type PrefetchTimers,
  type PrefetchVisibility,
  type VideoPrefetchTarget,
  type VideoPrefetchTelemetry,
} from './src/utils/videoPrefetch';

const currentPath = '/api/archive/proxy?path=%2Fdownload%2Fsynthetic-item%2Fcurrent.mp4';
const nextPath = '/api/archive/proxy?path=%2Fdownload%2Fsynthetic-item%2Fnext.mp4';
const target: VideoPrefetchTarget = {
  src: nextPath,
  mediaType: 'video',
  guideId: 'classic-tv',
  channelId: 'synthetic-channel',
  programId: 'synthetic-next',
};

class FakeMedia implements PrefetchMedia {
  currentTime = 0;
  duration = 100;
  paused = false;
  ended = false;
  readyState = 4;
  private listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, listener: () => void): void {
    const group = this.listeners.get(type) ?? new Set<() => void>();
    group.add(listener);
    this.listeners.set(type, group);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

class FakeVisibility implements PrefetchVisibility {
  hidden = false;
  private listeners = new Set<() => void>();

  addEventListener(_type: 'visibilitychange', listener: () => void): void { this.listeners.add(listener); }
  removeEventListener(_type: 'visibilitychange', listener: () => void): void { this.listeners.delete(listener); }
  dispatch(): void { for (const listener of this.listeners) listener(); }
}

class FakeTimers implements PrefetchTimers {
  private nextId = 1;
  private nowMs = 0;
  private tasks = new Map<number, { at: number; callback: () => void }>();

  setTimeout(callback: () => void, ms: number): number {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.nowMs + ms, callback });
    return id;
  }

  clearTimeout(handle: unknown): void { this.tasks.delete(Number(handle)); }

  advance(ms: number): void {
    this.nowMs += ms;
    const due = [...this.tasks.entries()].filter(([, task]) => task.at <= this.nowMs).sort((a, b) => a[1].at - b[1].at);
    for (const [id, task] of due) {
      this.tasks.delete(id);
      task.callback();
    }
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

interface Harness {
  media: FakeMedia;
  visibility: FakeVisibility;
  timers: FakeTimers;
  requests: Array<{ input: RequestInfo | URL; init?: RequestInit & { priority?: string } }>;
  telemetry: VideoPrefetchTelemetry[];
  cleanup: () => void;
  resolveCount: () => number;
  setNow: (value: number) => void;
}

function harness(overrides: Partial<ArchiveVideoPrefetchOptions> = {}): Harness {
  const media = new FakeMedia();
  const visibility = new FakeVisibility();
  const timers = new FakeTimers();
  const requests: Harness['requests'] = [];
  const telemetry: VideoPrefetchTelemetry[] = [];
  let resolveCalls = 0;
  let clock = 0;
  const options: ArchiveVideoPrefetchOptions = {
    media,
    currentSrc: currentPath,
    currentMediaType: 'video',
    currentGuideId: 'classic-tv',
    currentChannelId: 'synthetic-channel',
    currentProgramId: 'synthetic-current',
    resolveNext: async () => { resolveCalls++; return target; },
    visibility,
    timers,
    now: () => clock,
    fetcher: async (input, init) => {
      requests.push({ input, init: init as RequestInit & { priority?: string } });
      clock += 8;
      return new Response(new Uint8Array(1024), {
        status: 206,
        headers: { 'Content-Range': 'bytes 0-1023/10000', 'Content-Length': '1024' },
      });
    },
    onTelemetry: (event) => telemetry.push(event),
    ...overrides,
  };
  return {
    media, visibility, timers, requests, telemetry,
    cleanup: attachArchiveVideoPrefetch(options),
    resolveCount: () => resolveCalls,
    setNow: (value) => { clock = value; },
  };
}

assert.equal(isArchiveProxyPath(currentPath), true);
for (const invalid of [
  'https://archive.org/download/synthetic-item/current.mp4',
  '/api/archive/proxy?path=https%3A%2F%2Fevil.example%2Fvideo.mp4',
  '/api/archive/proxy?path=%2Fdownload%2Fitem%2Fvideo.mp4%3Ftoken%3Dsecret',
  '/api/archive/proxy?path=%2Fdownload%2Fitem%2Fvideo.m3u8',
  '/api/archive/proxy?path=%2Fdownload%2Fitem%2Fvideo.mp4&other=1',
]) assert.equal(isArchiveProxyPath(invalid), false, invalid);

{
  const h = harness();
  h.media.currentTime = 60;
  h.media.dispatch('timeupdate');
  await flush();
  assert.equal(h.requests.length, 1, '60% threshold starts exactly one request');
  assert.equal(h.requests[0].input, nextPath);
  assert.equal(new Headers(h.requests[0].init?.headers).get('Range'), VIDEO_PREFETCH_RANGE);
  assert.equal(h.requests[0].init?.priority, 'low');
  assert.equal(h.requests[0].init?.method, 'GET');
  assert.equal(h.telemetry.length, 1);
  assert.deepEqual(
    { outcome: h.telemetry[0].outcome, bytes: h.telemetry[0].bytes, ms: h.telemetry[0].ms, nextPath: h.telemetry[0].nextPath },
    { outcome: 'completed', bytes: 1024, ms: 8, nextPath },
  );
  h.media.dispatch('timeupdate');
  await flush();
  assert.equal(h.requests.length, 1, 'a completed item is never prefetched twice');
  h.cleanup();
}

{
  const h = harness();
  h.media.duration = 200;
  h.media.currentTime = 110; // 90 seconds remain, before 60 percent
  h.media.dispatch('timeupdate');
  await flush();
  assert.equal(h.requests.length, 1, '90 seconds remaining triggers the earlier threshold');
  h.cleanup();
}

for (const skipped of [
  { name: 'audio', options: { currentMediaType: 'audio' } },
  { name: 'HLS', options: { isHls: true } },
  { name: 'save-data', options: { saveData: () => true } },
  { name: 'external current source', options: { currentSrc: 'https://archive.org/download/id/current.mp4' } },
  { name: 'different guide', options: { resolveNext: async () => ({ ...target, guideId: 'movies-classics-vault' }) } },
  { name: 'different channel', options: { resolveNext: async () => ({ ...target, channelId: 'other-channel' }) } },
  { name: 'external next source', options: { resolveNext: async () => ({ ...target, src: 'https://example.test/next.mp4' }) } },
  { name: 'same item', options: { resolveNext: async () => ({ ...target, src: currentPath }) } },
] as const) {
  const h = harness(skipped.options);
  h.media.currentTime = 60;
  h.media.dispatch('timeupdate');
  await flush();
  assert.equal(h.requests.length, 0, `${skipped.name} is excluded`);
  h.cleanup();
}

{
  const h = harness();
  h.media.currentTime = 60;
  h.media.readyState = 2;
  h.media.dispatch('timeupdate');
  assert.equal(h.resolveCount(), 0, 'readyState below 3 does not resolve or fetch next');
  h.media.readyState = 4;
  h.media.dispatch('waiting');
  h.media.dispatch('timeupdate');
  assert.equal(h.resolveCount(), 0, 'active stall does not resolve or fetch next');
  h.media.dispatch('playing');
  await flush();
  assert.equal(h.requests.length, 1, 'prefetch resumes after playing clears the stall');
  h.cleanup();
}

for (const status of [429, 503]) {
  const h = harness({
    fetcher: async (input, init) => {
      h.requests.push({ input, init: init as RequestInit & { priority?: string } });
      return new Response(null, { status });
    },
  });
  h.media.currentTime = 60;
  h.media.dispatch('timeupdate');
  await flush();
  h.media.dispatch('timeupdate');
  await flush();
  assert.equal(h.requests.length, 1, `${status} is not retried`);
  assert.equal(h.telemetry[0].outcome, status === 429 ? 'rate-limited' : 'server-error');
  h.cleanup();
}

async function pendingRequestHarness() {
  let requestSignal: AbortSignal | undefined;
  const h = harness({
    fetcher: async (input, init) => {
      h.requests.push({ input, init: init as RequestInit & { priority?: string } });
      requestSignal = init?.signal ?? undefined;
      return await new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      });
    },
  });
  h.media.currentTime = 60;
  h.media.dispatch('timeupdate');
  await flush();
  assert.equal(h.requests.length, 1, 'pending network request started');
  return { ...h, requestSignal };
}

{
  const h = await pendingRequestHarness();
  h.cleanup(); // item identity changed/unmounted
  assert.equal(h.requestSignal?.aborted, true);
  assert.equal(h.telemetry[0]?.outcome, 'aborted');
}

{
  const h = await pendingRequestHarness();
  h.visibility.hidden = true;
  h.visibility.dispatch();
  assert.equal(h.requestSignal?.aborted, true, 'hidden document aborts the active request');
  assert.equal(h.telemetry[0]?.outcome, 'cancelled-hidden');
  h.cleanup();
}

{
  const h = await pendingRequestHarness();
  h.media.paused = true;
  h.media.dispatch('pause');
  h.timers.advance(VIDEO_PREFETCH_PAUSE_CANCEL_MS - 1);
  assert.equal(h.requestSignal?.aborted, false, 'pause shorter than five minutes does not cancel');
  h.timers.advance(1);
  assert.equal(h.requestSignal?.aborted, true, 'pause beyond five minutes cancels');
  assert.equal(h.telemetry[0]?.outcome, 'cancelled-pause');
  h.cleanup();
}

{
  const h = await pendingRequestHarness();
  h.media.dispatch('stalled');
  assert.equal(h.requestSignal?.aborted, true, 'buffering current media cancels an in-flight warmup');
  assert.equal(h.telemetry[0]?.outcome, 'cancelled-buffering');
  h.cleanup();
}

assert.ok(VIDEO_PREFETCH_MAX_BYTES === 1_048_576);
console.log('PASS video-prefetch: exact 1 MiB low-priority Range; 60%/90 s thresholds; archive/same-channel gates; no retry; save-data/buffering gates; hidden/pause/item-change cancellation; telemetry');
