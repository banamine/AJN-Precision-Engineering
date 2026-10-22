import assert from 'node:assert/strict';
import { createPlaybackBridge } from './playbackBridge';
import type { CubeArticle } from './adapter';

const article: CubeArticle = {
  id: 'test-article',
  title: 'Synthetic test article',
  summary: '',
  publisherName: 'Synthetic source',
  publisherId: 'synthetic',
  publishedAt: new Date().toISOString(),
  canonicalUrl: 'https://publisher.invalid/article',
  imageUrl: null,
};
const events: string[] = [];
const bridge = createPlaybackBridge({
  getArchiveState: () => 'ok',
  stopExistingPlayback: () => events.push('stop'),
  startExistingPlayback: () => events.push('start'),
  onNoMedia: () => events.push('no-media'),
  onArchiveOffline: () => events.push('archive-offline'),
});
assert.equal(await bridge.requestPlayback(article), 'no-media');
assert.deepEqual(events, ['no-media'], 'media-free stories do not reach the player');

const archiveDown = createPlaybackBridge({
  getArchiveState: () => 'down',
  stopExistingPlayback: () => events.push('unexpected-stop'),
  startExistingPlayback: () => events.push('unexpected-start'),
  onNoMedia: () => {},
  onArchiveOffline: () => events.push('archive-offline'),
});
const archiveArticle = { ...article, mediaReference: { type: 'native' as const, src: 'https://archive.org/download/test/file.mp4' } };
assert.equal(await archiveDown.requestPlayback(archiveArticle), 'archive-offline');
assert.deepEqual(events.slice(-1), ['archive-offline']);

const resolveStates: Array<(state: 'ok') => void> = [];
const order: string[] = [];
const staleBridge = createPlaybackBridge({
  getArchiveState: () => new Promise((resolve) => { resolveStates.push(resolve); }),
  stopExistingPlayback: () => order.push('stop'),
  startExistingPlayback: (item) => order.push(`start:${item.id}`),
  onNoMedia: () => {},
  onArchiveOffline: () => {},
});
const withMedia = { ...article, mediaReference: { type: 'native' as const, src: 'https://publisher.invalid/video.mp4' } };
const first = staleBridge.requestPlayback({ ...withMedia, id: 'first' });
const second = staleBridge.requestPlayback({ ...withMedia, id: 'second' });
resolveStates.forEach((resolve) => resolve('ok'));
await Promise.resolve();
await Promise.resolve();
assert.equal(await first, 'stale');
assert.equal(await second, 'started');
assert.deepEqual(order, ['stop', 'start:second'], 'only the last request starts and stop precedes the shared player entry');
staleBridge.pause();
assert.deepEqual(order, ['stop', 'start:second', 'stop'], 'cube navigation pauses cube-originated playback');

console.log('News Cube playback bridge: PASS (no media, Archive outage, stale requests, single-player stop order)');
