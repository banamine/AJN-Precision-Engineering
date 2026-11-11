import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LiveSongDeckView, appendHeard, HEARD_MAX } from './src/components/LiveSongDeck';
import type { LiveRadioNowPlaying } from './src/hooks/useLiveRadioNowPlaying';

const np = (o: Partial<LiveRadioNowPlaying>): LiveRadioNowPlaying => ({ recent: [], state: 'ok', current: null, reason: null, refreshFailed: false, ...o });
const html = (p: LiveRadioNowPlaying, hasStation = true, heard: { artist: string; title: string; atMs: number }[] = []) =>
  renderToStaticMarkup(createElement(LiveSongDeckView, { np: p, stationTitle: 'Test FM', hasStation, playing: true, heard }));

// ok: song + recent from the station's own feed
let h = html(np({ current: { artist: 'Prince', title: 'Kiss', artUrl: null }, recent: [{ artist: 'Cher', title: 'Believe', playedLabel: '2:10 PM' }] }));
assert.match(h, /ON AIR · SONG FEED/); assert.match(h, /Kiss/); assert.match(h, /Prince/); assert.match(h, /Recently played/); assert.match(h, /Cher – Believe/); assert.match(h, /2:10 PM/);
// stale feed is labelled, never shown as live
h = html(np({ state: 'stale', current: { artist: 'A', title: 'B', artUrl: null } })); assert.match(h, /LAST SONG · FEED OLD/);
// no song (talk / ad break), unsupported, error, loading, no station: each says so and invents nothing
assert.match(html(np({ state: 'none' })), /No song right now/);
h = html(np({ state: 'unsupported' })); assert.match(h, /NO SONG TEXT/); assert.match(h, /does not send song text/); assert.doesNotMatch(h, /refreshed every 30 s/);
h = html(np({ state: 'error', reason: 'station feed timed out' })); assert.match(h, /SONG FEED UNAVAILABLE/); assert.match(h, /station feed timed out/);
assert.match(html(np({ state: 'loading' })), /CHECKING SONG FEED/);
h = html(np({ state: 'loading' }), false); assert.match(h, /NO STATION/); assert.match(h, /Tune a live station/);
// refresh failure keeps the last song and says so
assert.match(html(np({ current: { artist: 'A', title: 'B', artUrl: null }, refreshFailed: true })), /Couldn.{1,6}t refresh/);
// no feed history: shows what was heard this session (skipping the current song)
h = html(np({ current: { artist: 'X', title: 'Now', artUrl: null } }), true, [{ artist: 'X', title: 'Now', atMs: 2 }, { artist: 'Y', title: 'Before', atMs: 1 }]);
assert.match(h, /Heard since you tuned in/); assert.match(h, /Y – Before/); assert.doesNotMatch(h, /X – Now/);
// session log: dedup against newest, bounded, newest first
let log = appendHeard([], { artist: 'A', title: 'One' }, 1); log = appendHeard(log, { artist: 'a', title: 'one' }, 2); assert.equal(log.length, 1);
log = appendHeard(log, { artist: 'B', title: 'Two' }, 3); assert.deepEqual(log.map((x) => x.title), ['Two', 'One']);
assert.equal(appendHeard(log, null, 4), log);
let big = log; for (let i = 0; i < HEARD_MAX + 20; i++) big = appendHeard(big, { artist: 'Z', title: `t${i}` }, 10 + i); assert.equal(big.length, HEARD_MAX);
// head unit wiring: live mode renders the deck, and the keys are cockpit keys
import { RadioPresetsBar } from './src/components/RadioPresetsBar';
const unit = renderToStaticMarkup(createElement(RadioPresetsBar, { station: null, live: false, onPlay: () => {}, initialView: 'unit' }));
assert.match(unit, /data-testid="live-song-deck"/); assert.match(unit, /ck-key/);
console.log('live song deck: all checks passed');
