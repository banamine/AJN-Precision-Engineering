import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatusIndicatorsView } from './src/components/StatusIndicators.tsx';
import { createNewsReadyPoller, type NewsReadySnapshot } from './src/utils/newsReadyStore.ts';
import { describeArchiveStatus, describeNetworkStatus, describeNewsStatus } from './src/utils/serviceStatus.ts';
import { createArchiveStatusPoller } from './src/hooks/useArchiveStatus.ts';
import { isArchiveHostedThumbUrl } from './src/utils/thumbnail.ts';
import { shouldHoldForArchiveOutage } from './src/utils/playbackFailurePolicy.ts';
import {
  getLastArchiveProgressAt,
  getLastArchiveProgressPosition,
  isArchivePlaybackSource,
  recordArchivePlaybackProgress,
} from './src/utils/archivePlaybackEvidence.ts';

// ── Archive indicator: every server state maps to a distinct, labelled, shape-coded state ──
const arch = (state: any, phase: any = 'live', progressAt: number | null = null, now = 100_000) =>
  describeArchiveStatus({ phase, state, since: null, now, progressAt });
assert.deepEqual([arch('ok').tone, arch('ok').label], ['ok', 'Archive available']);
assert.deepEqual([arch('degraded').tone, arch('degraded').label], ['warn', 'Archive slow']);
assert.deepEqual([arch('down').tone, arch('down').label], ['error', 'Archive unavailable']);
assert.deepEqual([arch('unreachable_from_here').tone, arch('unreachable_from_here').label], ['error', 'Archive unavailable']);
assert.match(arch('unreachable_from_here').detail.join(' '), /server's own network/);
assert.deepEqual([arch('unknown').tone, arch('unknown').label], ['neutral', 'Archive not checked']);
assert.deepEqual([arch('unknown', 'checking').tone, arch('unknown', 'checking').label], ['neutral', 'Archive checking'], 'loading is not success');
assert.deepEqual([arch('unknown', 'unavailable').tone, arch('unknown', 'unavailable').label], ['warn', 'Archive status unknown'], 'failed status poll is not "down"');
assert.equal(arch('down', 'live', 95_000).label, 'Archive playing', 'recent progress overrides a stale outage verdict');
assert.match(arch('down', 'live', 95_000).detail.join(' '), /last check said Archive was unavailable/);
assert.equal(arch('down', 'live', 79_999).label, 'Archive unavailable', 'progress older than 20 s no longer suppresses');
assert.equal(arch('degraded', 'live', 95_000).tone, 'ok');
for (const ind of [arch('ok'), arch('degraded'), arch('down'), arch('unknown')]) {
  assert.match(ind.label, /^Archive /, 'label names the service — colour is never the only signal');
  assert.equal(ind.pulseKey, null, 'Archive states never pulse');
}
console.log('PASS archive indicator: available/slow/unavailable/checking/not-checked/status-unknown + progress override with expiry');

// ── News + network indicators ──
const news = (over: Partial<NewsReadySnapshot>): NewsReadySnapshot => ({ phase: 'current', version: 1, newShows: [], fetchedAt: null, refreshing: false, checkedAt: null, ...over });
const show = { channelId: 'cnn', channelName: 'CNN', title: 'Evening', programId: 'program-a' };
const ready = describeNewsStatus(news({ phase: 'ready', version: 7, newShows: [show, { ...show, programId: 'program-b' }] }));
assert.deepEqual([ready.tone, ready.label, ready.count, ready.pulseKey], ['ok', 'News ready', 2, 'news-7']);
assert.deepEqual([describeNewsStatus(news({ phase: 'checking' })).label, describeNewsStatus(news({ phase: 'checking' })).tone], ['News checking', 'neutral']);
assert.deepEqual([describeNewsStatus(news({ phase: 'error' })).label, describeNewsStatus(news({ phase: 'error' })).tone], ['News delayed', 'warn']);
assert.equal(describeNewsStatus(news({ refreshing: true })).label, 'News updating');
assert.deepEqual([describeNewsStatus(news({})).label, describeNewsStatus(news({})).pulseKey], ['News current', null]);
assert.equal(describeNetworkStatus(true), null, 'no indicator while online');
assert.equal(describeNetworkStatus(false)?.label, 'Offline');
console.log('PASS news indicator: checking/updating/current/delayed/ready(+count, one pulse key per version); offline only while offline');

// ── Rendered row: compact, nothing auto-opens, report only on request with a Close button ──
const rowHtml = renderToStaticMarkup(React.createElement(StatusIndicatorsView, {
  indicators: [ready, arch('degraded')], newsSnapshot: news({ phase: 'ready', version: 7, newShows: [show] }), onNewsSeen: () => {},
}));
assert.match(rowHtml, /data-testid="status-indicator-news"/);
assert.match(rowHtml, /data-testid="status-indicator-archive"[^>]*data-tone="warn"/);
assert.match(rowHtml, /aria-label="Archive status: Archive slow\. Show details\."/);
assert.match(rowHtml, /aria-expanded="false"/);
assert.doesNotMatch(rowHtml, /role="dialog"|role="tooltip"|role="alert"/, 'no report, tooltip or alert without user interaction');
assert.doesNotMatch(rowHtml, /archive-outage-banner|news-ready-dock/, 'legacy banners are gone');
assert.match(rowHtml, /ajn-status-pulse/, 'new news gets the brief pulse');
const openHtml = renderToStaticMarkup(React.createElement(StatusIndicatorsView, {
  indicators: [ready, arch('degraded')], newsSnapshot: news({ phase: 'ready', version: 7, newShows: [show] }), onNewsSeen: () => {}, initialOpenId: 'news',
}));
assert.match(openHtml, /role="dialog"[^>]*aria-modal="false"/);
assert.match(openHtml, /data-testid="status-report-news"/);
assert.match(openHtml, />Close</);
assert.match(openHtml, /Mark as seen/);
assert.match(openHtml, /CNN:/);
console.log('PASS indicator row renders labelled, non-blocking pills; report opens only on request and has Close');

// ── News poller: baseline, ready, seen, failure keeps list, server restart rebaselines ──
{
  let version = 3; let shows: any[] = []; let fail = false; let calls = 0;
  const p = createNewsReadyPoller({
    isVisible: () => true,
    onVisibilityChange: () => () => {},
    setIntervalImpl: (() => ({ unref() {} })) as unknown as typeof setInterval,
    clearIntervalImpl: (() => {}) as typeof clearInterval,
    now: () => 5_000,
    fetchImpl: (async () => { calls++; if (fail) throw new Error('synthetic'); return Response.json({ version, fetchedAt: null, refreshing: false, newShows: shows }); }) as typeof fetch,
  });
  assert.equal(p.getSnapshot().phase, 'checking');
  await p.refresh();
  assert.equal(p.getSnapshot().phase, 'current', 'first answer is the baseline, not new news');
  version = 4; shows = [show];
  await p.refresh();
  assert.equal(p.getSnapshot().phase, 'ready');
  fail = true; await p.refresh();
  assert.equal(p.getSnapshot().phase, 'ready', 'a failed check keeps the unseen list');
  fail = false; p.markSeen();
  assert.equal(p.getSnapshot().phase, 'current');
  await p.refresh();
  assert.equal(p.getSnapshot().phase, 'current', 'seen version does not come back');
  version = 1; shows = [show]; await p.refresh();
  assert.equal(p.getSnapshot().phase, 'current', 'server restart (version went backwards) rebaselines');
  version = 2; await p.refresh();
  assert.equal(p.getSnapshot().phase, 'ready', 'news after a restart is detected again');
  const before = calls; await Promise.all([p.refresh(), p.refresh()]);
  assert.equal(calls, before + 1, 'concurrent refreshes share one request');
  const fresh = createNewsReadyPoller({ isVisible: () => true, onVisibilityChange: () => () => {}, fetchImpl: (async () => new Response('x', { status: 503 })) as typeof fetch });
  await fresh.refresh();
  assert.equal(fresh.getSnapshot().phase, 'error');
  console.log('PASS news poller: baseline, ready, keep-on-failure, mark seen, restart rebaseline, de-duplicated requests, HTTP error → delayed');
}

let visible = true;
let visibilityListener: (() => void) | null = null;
let intervalCallback: (() => void) | null = null;
let intervalStarts = 0;
let intervalClears = 0;
let requests = 0;
let failFetch = false;
const poller = createArchiveStatusPoller({
  isVisible: () => visible,
  onVisibilityChange: (listener) => {
    visibilityListener = listener;
    return () => { visibilityListener = null; };
  },
  setIntervalImpl: ((callback: () => void) => {
    intervalStarts++;
    intervalCallback = callback;
    return { unref() {} } as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval,
  clearIntervalImpl: (() => { intervalClears++; intervalCallback = null; }) as typeof clearInterval,
  fetchImpl: (async () => {
    requests++;
    if (failFetch) throw new Error('synthetic poll failure');
    return Response.json({ state: 'down', since: 1234 });
  }) as typeof fetch,
});

const unsubscribe = poller.subscribe(() => {});
await poller.refresh();
assert.deepEqual(poller.getSnapshot(), { state: 'down', since: 1234, phase: 'live' });
assert.equal(intervalStarts, 1);
visible = false;
visibilityListener?.();
assert.equal(intervalClears, 1, 'hidden tab pauses its interval');
const beforeHiddenRefresh = requests;
await poller.refresh();
assert.equal(requests, beforeHiddenRefresh, 'hidden state makes no poll request');
visible = true;
visibilityListener?.();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(requests, beforeHiddenRefresh + 1, 'visibility return polls immediately');
failFetch = true;
await poller.refresh();
assert.deepEqual(poller.getSnapshot(), { state: 'unknown', since: null, phase: 'unavailable' }, 'a failed poll is unavailable/unknown, not down');
assert.equal(intervalCallback !== null, true);
unsubscribe();
assert.equal(visibilityListener, null);
console.log('PASS poller shares one interval, pauses hidden, refreshes visible, failed poll becomes unknown');

assert.equal(isArchiveHostedThumbUrl('https://archive.org/services/img/item'), true);
assert.equal(isArchiveHostedThumbUrl('https://dn123.us.archive.org/a.jpg'), true);
assert.equal(isArchiveHostedThumbUrl('/api/archive/proxy?path=%2Fdownload%2Fx%2Fx.jpg'), true);
assert.equal(isArchiveHostedThumbUrl('/thumbs/classic-archive.jpg'), false);
assert.equal(shouldHoldForArchiveOutage('down', true), true);
assert.equal(shouldHoldForArchiveOutage('unreachable_from_here', true), true);
assert.equal(shouldHoldForArchiveOutage('degraded', true), false);
assert.equal(shouldHoldForArchiveOutage('down', false), false, 'non-Archive sources continue');
assert.equal(shouldHoldForArchiveOutage('down', true, true), false, 'item-specific failures still skip');
assert.equal(isArchivePlaybackSource('/api/archive/proxy?path=%2Fdownload%2Fdemo%2Fepisode.mp3'), true);
assert.equal(isArchivePlaybackSource('https://archive.org/download/demo/episode.mp4'), true);
assert.equal(isArchivePlaybackSource('/api/media/proxy?url=https%3A%2F%2Fcdn.example%2Fepisode.mp3'), false);
assert.equal(recordArchivePlaybackProgress('/api/archive/proxy?path=%2Fdownload%2Fdemo%2Fepisode.mp3', 0, 100), false);
assert.equal(recordArchivePlaybackProgress('/api/archive/proxy?path=%2Fdownload%2Fdemo%2Fepisode.mp3', 1, 1_000), true);
assert.equal(getLastArchiveProgressAt(), 1_000);
assert.equal(getLastArchiveProgressAt('https://archive.org/download/demo/episode.mp3'), 1_000);
assert.equal(getLastArchiveProgressAt('/api/archive/proxy?path=%2Fdownload%2Fother%2Fepisode.mp3'), null);
assert.equal(getLastArchiveProgressPosition('https://archive.org/download/demo/episode.mp3'), 1);
assert.equal(getLastArchiveProgressPosition('/api/archive/proxy?path=%2Fdownload%2Fother%2Fepisode.mp3'), null);
assert.equal(recordArchivePlaybackProgress('/api/archive/proxy?path=%2Fdownload%2Fdemo%2Fepisode.mp3', 0.5, 2_000), false);
assert.equal(getLastArchiveProgressAt(), null, 'backward seek clears the recent-progress claim until playback advances again');
assert.equal(recordArchivePlaybackProgress('/api/archive/proxy?path=%2Fdownload%2Fdemo%2Fepisode.mp3', 1, 3_000), true);
assert.equal(recordArchivePlaybackProgress('/audio/local.mp3', 2, 2_000), false);
assert.equal(getLastArchiveProgressAt(), null, 'non-Archive playback clears Archive-only progress evidence');
assert.equal(getLastArchiveProgressPosition(), null);
console.log('PASS outage thumbnail filtering and playback hold policy; definite failures/non-Archive sources unchanged');
