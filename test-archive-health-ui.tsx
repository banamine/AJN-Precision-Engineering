import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArchiveOutageBanner } from './src/components/ArchiveOutageBanner.tsx';
import { createArchiveStatusPoller } from './src/hooks/useArchiveStatus.ts';
import { isArchiveHostedThumbUrl } from './src/utils/thumbnail.ts';
import { shouldHoldForArchiveOutage } from './src/utils/playbackFailurePolicy.ts';

const downHtml = renderToStaticMarkup(React.createElement(ArchiveOutageBanner, { state: 'down' }));
assert.match(downHtml, /Archive is offline right now/);
assert.match(downHtml, /Live radio and other sources still work/);
assert.match(renderToStaticMarkup(React.createElement(ArchiveOutageBanner, { state: 'degraded' })), /Archive is slow right now/);
assert.match(renderToStaticMarkup(React.createElement(ArchiveOutageBanner, { state: 'unreachable_from_here' })), /This server can&#x27;t reach the internet right now/);
assert.equal(renderToStaticMarkup(React.createElement(ArchiveOutageBanner, { state: 'unknown' })), '');
console.log('PASS banner renders down, unreachable, degraded; unknown stays unlabelled');

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
assert.deepEqual(poller.getSnapshot(), { state: 'down', since: 1234 });
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
assert.deepEqual(poller.getSnapshot(), { state: 'unknown', since: null }, 'a failed poll is unknown, not down');
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
console.log('PASS outage thumbnail filtering and playback hold policy; definite failures/non-Archive sources unchanged');
