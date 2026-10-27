import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DemoApp } from './DemoApp';
import type { DemoFetchFixture, DemoWindow } from './demo-types';

const AJN_DEMO_MODE = 'AJN_DEMO_MODE';
const DEMO_STORAGE_PREFIX = 'ajn.demo.';
const DEMO_VTT = `WEBVTT

00:00:00.000 --> 00:00:02.000
DEMO — synthetic subtitle line
`;

function namespacedKey(key: string): string {
  return key.startsWith(DEMO_STORAGE_PREFIX) ? key : `${DEMO_STORAGE_PREFIX}${key}`;
}

function installDemoStorageNamespace(): void {
  const prototype = Storage.prototype;
  const originalGet = prototype.getItem;
  const originalSet = prototype.setItem;
  const originalRemove = prototype.removeItem;
  const originalClear = prototype.clear;
  prototype.getItem = function (key: string) { return originalGet.call(this, namespacedKey(key)); };
  prototype.setItem = function (key: string, value: string) { return originalSet.call(this, namespacedKey(key), value); };
  prototype.removeItem = function (key: string) { return originalRemove.call(this, namespacedKey(key)); };
  prototype.clear = function () {
    const keys: string[] = [];
    for (let index = 0; index < this.length; index += 1) {
      const key = this.key(index);
      if (key?.startsWith(DEMO_STORAGE_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => originalRemove.call(this, key));
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function pendingUntilAbort(signal?: AbortSignal): Promise<Response> {
  return new Promise((_resolve, reject) => {
    if (!signal) return;
    if (signal.aborted) {
      reject(new DOMException('DEMO request aborted', 'AbortError'));
      return;
    }
    signal.addEventListener('abort', () => reject(new DOMException('DEMO request aborted', 'AbortError')), { once: true });
  });
}

function demoFixture(): DemoFetchFixture {
  return (window as DemoWindow).__AJN_DEMO_FIXTURE__ ?? {
    archive: 'checking',
    news: 'checking',
    offline: false,
    player: '',
  };
}

function installDemoFetchLayer(): void {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const requestUrl = input instanceof Request ? input.url : String(input);
    const url = new URL(requestUrl, window.location.href);
    if (url.origin !== window.location.origin) {
      throw new TypeError('DEMO external network requests are disabled');
    }
    const fixture = demoFixture();
    if (url.pathname === '/api/archive/status') {
      if (fixture.archive === 'checking') return pendingUntilAbort(init?.signal ?? (input instanceof Request ? input.signal : undefined));
      if (fixture.archive === 'unavailable') return jsonResponse({ error: 'DEMO status fixture unavailable' }, 503);
      const state = fixture.archive === 'available' ? 'ok'
        : fixture.archive === 'slow' ? 'degraded'
          : fixture.archive === 'playing' ? 'down'
            : 'unknown';
      return jsonResponse({ state, since: Date.now() - 60_000 });
    }
    if (url.pathname === '/api/news/version') {
      if (fixture.news === 'checking') return pendingUntilAbort(init?.signal ?? (input instanceof Request ? input.signal : undefined));
      if (fixture.news === 'delayed') return jsonResponse({ error: 'DEMO news fixture delayed' }, 503);
      const ready = fixture.news === 'ready';
      return jsonResponse({
        version: ready ? 2 : 1,
        fetchedAt: '2026-10-25T12:00:00.000Z',
        refreshing: fixture.news === 'updating',
        newShows: ready ? [1, 2, 3].map((number) => ({
          channelId: 'demo-channel',
          channelName: 'DEMO network',
          title: `DEMO — synthetic news item ${number}`,
          programId: `demo-news-${number}`,
        })) : [],
      });
    }
    if (url.pathname === '/api/archive/subtitles') {
      if (fixture.player === 'no-subtitles') return new Response('', { status: 404 });
      const vtt = await originalFetch('/demo/english.vtt');
      if (vtt.ok) return vtt;
      return new Response(DEMO_VTT, { status: 200, headers: { 'content-type': 'text/vtt; charset=utf-8' } });
    }
    if (url.pathname === '/api/archive/proxy' && init?.headers && new Headers(init.headers).get('accept')?.includes('application/json')) {
      if (fixture.player === 'retry') {
        return jsonResponse({
          error: 'DEMO — synthetic circuit-open response',
          errorCode: 'AJN_UPSTREAM_CIRCUIT_OPEN',
          upstreamStatus: 503,
          retryAfterSeconds: 8,
        }, 503);
      }
      if (fixture.player === 'restricted') {
        return jsonResponse({ error: 'DEMO — synthetic restricted item', upstreamStatus: 403 }, 403);
      }
      if (fixture.player === 'non-media') {
        return jsonResponse({
          error: 'DEMO — UPSTREAM_NON_MEDIA: upstream returned HTML instead of media',
          errorCode: 'UPSTREAM_NON_MEDIA',
          upstreamStatus: 422,
        }, 422);
      }
    }
    if (url.pathname === '/api/health' || url.pathname === '/api/telemetry') {
      return new Response(null, { status: 204 });
    }
    if (url.pathname.startsWith('/api/')) return jsonResponse({ error: 'DEMO mock endpoint not configured' }, 404);
    return originalFetch(input, init);
  };
}

export function mountDemo(root: HTMLElement): void {
  document.title = 'AJN Demo — offline fixtures';
  if (!window.location.hash) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#demo`);
  installDemoStorageNamespace();
  installDemoFetchLayer();
  createRoot(root).render(
    <StrictMode>
      <div data-demo-mode={AJN_DEMO_MODE}>
        <DemoApp />
      </div>
    </StrictMode>,
  );
}
