import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Browser stand-ins: the dock only reads window/document inside effects, which static rendering skips.
const store = new Map<string, string>();
(globalThis as any).window = { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } }, dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} };
(globalThis as any).document = { getElementById: () => null, querySelector: () => null };

const { loadRadioPresets, listRadioPresets, pickAdjacentStation } = await import('./src/utils/radioPresets');
const { MiniPlayerDock } = await import('./src/components/MiniPlayerDock');

// Prev/Next order and wrap: 5 factory stations, 1..5
const list = listRadioPresets(loadRadioPresets());
assert.equal(list.length, 5);
assert.equal(pickAdjacentStation(list, list[0].channelId, -1)?.channelId, list[4].channelId, 'Prev from key 1 wraps to key 5');
assert.equal(pickAdjacentStation(list, list[4].channelId, 1)?.channelId, list[0].channelId, 'Next from key 5 wraps to key 1');
assert.equal(pickAdjacentStation(list, list[1].channelId, 1)?.channelId, list[2].channelId);
assert.equal(pickAdjacentStation(list, 'radio:not-saved', 1)?.channelId, list[0].channelId, 'unsaved station: Next goes to key 1');
assert.equal(pickAdjacentStation(list, 'radio:not-saved', -1)?.channelId, list[4].channelId, 'unsaved station: Prev goes to key 5');
assert.equal(pickAdjacentStation([], 'x', 1), undefined);

// The dock shows the stepper for a radio station, and not for a video.
const noop = () => {};
const radio = renderToStaticMarkup(createElement(MiniPlayerDock, { nowPlaying: { src: 'https://s.example/a.mp3', title: 'Warm 109', mediaType: 'audio', channelId: 'radio:ch109-warm-109' } as any, onOpenFullPlayer: noop, onDismiss: noop }));
assert.match(radio, /data-testid="dock-prev"/); assert.match(radio, /data-testid="dock-next"/);
assert.match(radio, /min-h-\[48px\]/); assert.match(radio, /aria-label="Open Radio"/);
const video = renderToStaticMarkup(createElement(MiniPlayerDock, { nowPlaying: { src: 'https://s.example/v.mp4', title: 'A film', mediaType: 'video', channelId: 'classic:film' } as any, onOpenFullPlayer: noop, onDismiss: noop }));
assert.ok(!video.includes('dock-prev') && !video.includes('dock-next'), 'no stepper for video');
assert.match(video, /aria-label="Open Full Player"/);
console.log('dock stepper: all checks passed');

// Buffer seconds are measured from the element's buffered ranges, never invented.
const { bufferAheadSeconds, dockStatusLabel } = await import('./src/utils/bufferAhead');
const ranges = (...r: Array<[number, number]>) => ({ length: r.length, start: (i: number) => r[i][0], end: (i: number) => r[i][1] }) as unknown as TimeRanges;
assert.equal(bufferAheadSeconds({ currentTime: 10, buffered: ranges([0, 22]) }), 12);
assert.equal(bufferAheadSeconds({ currentTime: 30, buffered: ranges([0, 22]) }), 0, 'playhead outside every range = nothing ahead');
assert.equal(bufferAheadSeconds({ currentTime: 5, buffered: ranges() }), 0);
assert.equal(dockStatusLabel('buffering', true, 12, 2), 'Reconnecting · 12s');
assert.equal(dockStatusLabel('buffering', true, 0.4, 1), 'Reconnecting');
assert.equal(dockStatusLabel('failed', true, 0, 3), 'Reconnecting', 'while the player is still retrying, the dock says so instead of failed');
assert.equal(dockStatusLabel('failed', true, 0, 0), 'failed', 'player gave up (flag removed): failed');
assert.equal(dockStatusLabel('playing', true, 12, 2), 'LIVE', 'sound is back: never say Reconnecting over playing audio');
assert.equal(dockStatusLabel('playing', true, 5, 0), 'LIVE');
assert.equal(dockStatusLabel('paused', false, 0, 0), 'paused');

// Player side (source guards): backoff 1/2/4/8 s, retry flag published and removed, live streams never seek back.
const fs = await import('node:fs');
const player = fs.readFileSync('src/MinimalPlayer.tsx', 'utf-8');
assert.match(player, /RECOVER_DELAYS_MS = \[1000, 2000, 4000, 8000\]/);
assert.match(player, /media\.dataset\.reconnect = String\(attempt\)/);
assert.equal((player.match(/delete media\.dataset\.reconnect/g) ?? []).length, 2, 'flag removed on give-up and on recovery');
assert.equal((player.match(/pendingSeek = lastRetryPos > 1 && !isLiveStream\(\) \? lastRetryPos : null/g) ?? []).length, 2, 'live streams skip the seek-back in both retry paths');
console.log('dock buffer status: all checks passed');

// Always-on bar: the idle dock carries the Radio slot, and the floating Radio button is gone.
const { IdleDock } = await import('./src/components/MiniPlayerDock');
const idle = renderToStaticMarkup(createElement(IdleDock, {}));
assert.match(idle, /data-testid="idle-dock"/); assert.match(idle, /id="radio-dock-slot"/); assert.match(idle, /data-testid="idle-dock-play"/);
const dockSrc = fs.readFileSync('src/components/RadioDock.tsx', 'utf-8');
assert.match(dockSrc, /radioButton && dockButtonHost && createPortal\(radioButton, dockButtonHost\)/, 'Radio button renders only inside the dock');
console.log('always-on dock: all checks passed');
