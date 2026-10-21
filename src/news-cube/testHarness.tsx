import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import '../index.css';
import * as THREE from 'three';
import NewsCubePage from './NewsCubePage';
import { Navigation } from '../components/Navigation';
import { syntheticDigestFixture } from './syntheticDigestFixture.test';
import type { CubeArticle } from './adapter';
import type { CubeRendererFactory, CubeRendererPort } from './cubeRenderer';

const testNow = Date.parse('2026-10-21T18:00:00.000Z');
const defaultFixture = syntheticDigestFixture(testNow);
const queue: Array<{ payload?: unknown; error?: string }> = [];
let fetchCount = 0;
let pauseCount = 0;
let disposedCount = 0;
let rendererCount = 0;
let prepareCount = 0;
let lastDestination = '';
let root: Root | null = null;

Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });

const fetcher: typeof fetch = async () => {
  fetchCount += 1;
  const next = queue.shift();
  if (next?.error) throw new Error(next.error);
  const payload = next?.payload ?? defaultFixture;
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const rendererFactory: CubeRendererFactory = (canvas): CubeRendererPort => {
  rendererCount += 1;
  let quaternion = new THREE.Quaternion();
  let faceIndex = 0;
  return {
    render() {},
    resize() {},
    setFaceArticles() {},
    prepareFace() { prepareCount += 1; },
    getQuaternion: () => quaternion.clone(),
    targetQuaternion: (target) => { faceIndex = target; return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), target * Math.PI / 3); },
    setQuaternion(value) { quaternion = value.clone(); },
    rotateBy(x, y) { if (Math.abs(x) + Math.abs(y) > 0.02) faceIndex = (faceIndex + 1) % 6; },
    nearestFace: () => faceIndex,
    pick: () => ({ faceIndex, slotIndex: 0 }),
    dispose() { disposedCount += 1; canvas.dataset.disposed = 'true'; },
  };
};

const playbackBridge = {
  requestPlayback: async (_article: CubeArticle) => 'no-media' as const,
  pause() { pauseCount += 1; },
  invalidate() {},
  getRequestId: () => 0,
};

function mount() {
  root = createRoot(document.getElementById('root')!);
  root.render(<>
    <Navigation currentDestination="news-cube" onNavigate={(destination) => { lastDestination = destination; }} nowPlaying={null} />
    <main className="mx-auto max-w-7xl px-4 pt-8 pb-20">
      <NewsCubePage
        fetcher={fetcher}
        digestUrl="/synthetic-digest"
        refreshMs={1000}
        now={() => testNow}
        rendererFactory={rendererFactory}
        playbackBridge={playbackBridge}
        reducedMotionOverride
        archiveStateOverride="ok"
      />
    </main>
  </>);
}

(window as any).__newsCubeHarness = {
  mount,
  enqueue(payload: unknown) { queue.push({ payload }); },
  enqueueError(error: string) { queue.push({ error }); },
  getStats() { return { fetchCount, pauseCount, disposedCount, rendererCount, prepareCount, queued: queue.length, lastDestination }; },
  setVisible(visible: boolean) {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: visible ? 'visible' : 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  },
  unmount() { root?.unmount(); root = null; },
};

mount();
