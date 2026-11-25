import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Browser stand-ins (the util only touches window for the change event).
const store = new Map<string, string>(); let events = 0;
(globalThis as any).window = { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } }, dispatchEvent: () => { events++; return true; }, addEventListener() {}, removeEventListener() {} };
(globalThis as any).Event = class { constructor(public type: string) {} };

const { loadRadioPresets, saveRadioPreset, clearRadioPreset, RADIO_PRESETS_KEY } = await import('./src/utils/radioPresets');
const { RadioPresetsBar } = await import('./src/components/RadioPresetsBar');

const st = (id: string, extra: Record<string, unknown> = {}) => ({ channelId: `radio:${id}`, title: `Station ${id}`, src: `https://s.example/${id}.mp3`, ...extra });

// ---- store ----
// a device that never saved gets the factory presets: AJN Live x2, then Classic Hits 109 x3
assert.deepEqual(Object.keys(loadRadioPresets()), ['1', '2', '3', '4', '5']);
assert.equal(loadRadioPresets()[1]?.channelId, 'radio:ajn-alex-jones-show');
assert.equal(loadRadioPresets()[3]?.channelId, 'radio:ch109-original');
let r = saveRadioPreset(1, st('a', { number: 683, logo: 'https://l.example/a.png', corsVerified: true, programId: 'radio:a:live:now', guideId: 'audio-podcasts', subtitle: 'City' }));
assert.equal(r.saved, true); assert.equal(events, 1);
assert.equal(r.presets[1]?.number, 683); assert.equal(r.presets[1]?.corsVerified, true);
saveRadioPreset(5, st('e'));
assert.deepEqual(Object.keys(loadRadioPresets()), ['1', '2', '3', '4', '5']); assert.equal(loadRadioPresets()[5]?.channelId, 'radio:e');
// overwrite keeps one entry per slot
saveRadioPreset(1, st('b'));
assert.equal(loadRadioPresets()[1]?.channelId, 'radio:b');
assert.equal(JSON.parse(store.get(RADIO_PRESETS_KEY)!).length, 5);
// refused: not a radio id, bad slot, missing src/title, junk number
const before = store.get(RADIO_PRESETS_KEY); const ev = events;
for (const [slot, input] of [[1, { ...st('x'), channelId: 'podcast:x' }], [0, st('x')], [6, st('x')], [1.5, st('x')], [1, { ...st('x'), src: '' }], [1, { ...st('x'), title: '' }]] as Array<[number, any]>) {
  assert.equal(saveRadioPreset(slot, input).saved, false, JSON.stringify([slot, input]));
}
assert.equal(store.get(RADIO_PRESETS_KEY), before); assert.equal(events, ev);
assert.equal(loadRadioPresets()[1]?.channelId, 'radio:b');
// junk number is dropped, station still saves
assert.equal(saveRadioPreset(2, st('n', { number: -4 })).presets[2]?.number, undefined);
assert.equal(saveRadioPreset(3, st('n3', { number: 12.5 })).presets[3]?.number, undefined);
// clear
clearRadioPreset(2); assert.equal(loadRadioPresets()[2], undefined); assert.equal(loadRadioPresets()[1]?.channelId, 'radio:b');
const evAfter = events; clearRadioPreset(2); assert.equal(events, evAfter, 'clearing an empty slot changes nothing');
// bad stored data
store.set(RADIO_PRESETS_KEY, '{bad'); assert.deepEqual(loadRadioPresets(), {});
store.set(RADIO_PRESETS_KEY, JSON.stringify([{ slot: 9, ...st('z') }, { slot: 2, ...st('y'), channelId: 'nope' }, { slot: 4, ...st('ok') }, { slot: 4, ...st('dup') }, null, 7]));
assert.deepEqual(Object.keys(loadRadioPresets()), ['4']); assert.equal(loadRadioPresets()[4]?.channelId, 'radio:ok');
// injectable storage never touches window storage
const mem = new Map<string, string>(); const inj = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
saveRadioPreset(3, st('inj'), inj); assert.equal(loadRadioPresets(inj)[3]?.channelId, 'radio:inj');
// storage that throws: no crash
const boom = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
assert.deepEqual(loadRadioPresets(boom), {}); assert.doesNotThrow(() => saveRadioPreset(1, st('q'), boom));

// ---- bar markup ----
// a listener who cleared every slot has stored an empty list, so no factory presets come back
store.clear(); store.set(RADIO_PRESETS_KEY, '[]');
const noop = () => {};
const playingNow = { src: 'https://s.example/b.mp3', title: 'Station b', channelId: 'radio:b' } as any;
let html = renderToStaticMarkup(createElement(RadioPresetsBar, { station: null, live: false, onPlay: noop }));
assert.equal((html.match(/data-testid="radio-preset-[1-5]"/g) ?? []).length, 5);
assert.equal((html.match(/data-filled="false"/g) ?? []).length, 5);
assert.match(html, /border-dashed/); assert.match(html, /Preset 1, empty/); assert.doesNotMatch(html, /radio-preset-live/);
assert.match(html, /role="status"/); assert.match(html, /aria-live="polite"/);
assert.match(html, /h-\[112px\]/);
// With presets in storage (initial state reads storage; the hook is client-side so server render uses the initial read)
saveRadioPreset(1, st('a', { number: 683, logo: 'https://l.example/a.png' }));
saveRadioPreset(2, st('b', { number: 109 }));
html = renderToStaticMarkup(createElement(RadioPresetsBar, { station: playingNow, live: true, onPlay: noop }));
assert.equal((html.match(/data-filled="true"/g) ?? []).length, 2);
assert.match(html, /#683/); assert.match(html, /#109/);
assert.match(html, /src="https:\/\/l\.example\/a\.png"/);
// preset 2 matches the playing station: active styling + one live dot, preset 1 is not active
assert.equal((html.match(/radio-preset-live/g) ?? []).length, 1);
assert.match(html, /aria-current="true"/); assert.equal((html.match(/aria-current="true"/g) ?? []).length, 1);
assert.match(html, /is-latched border-orange-500/);
// paused: still marked current, no live dot
html = renderToStaticMarkup(createElement(RadioPresetsBar, { station: playingNow, live: false, onPlay: noop }));
assert.doesNotMatch(html, /radio-preset-live/); assert.match(html, /current station/);
// initials tile for a preset without a logo
assert.match(html, />ST</);
// a non-radio now-playing item is never treated as a station
html = renderToStaticMarkup(createElement(RadioPresetsBar, { station: { ...playingNow, channelId: 'tv:x' }, live: true, onPlay: noop }));
assert.doesNotMatch(html, /aria-current="true"/);
// ---- Preset Wall: empty tile text, "All stations", wide mode, banks ----
store.clear(); store.set(RADIO_PRESETS_KEY, '[]');
html = renderToStaticMarkup(createElement(RadioPresetsBar, { station: null, live: false, onPlay: noop }));
assert.equal((html.match(/data-testid="radio-preset-[1-5]"/g) ?? []).length, 5);
assert.equal((html.match(/data-filled="false"/g) ?? []).length, 5);
assert.match(html, /Play a station, then hold to save\./);
assert.match(html, /All stations/); assert.doesNotMatch(html, /radio-preset-6/);
assert.match(html, /data-testid="radio-bank-presets"/); assert.match(html, /data-testid="radio-bank-recent"/);
html = renderToStaticMarkup(createElement(RadioPresetsBar, { station: playingNow, live: true, onPlay: noop }));
assert.match(html, /\+ Save &quot;Station b&quot; here/, 'empty tile shows the FULL station name');
assert.doesNotMatch(html, /Save Station here/);
html = renderToStaticMarkup(createElement(RadioPresetsBar, { station: null, live: false, onPlay: noop, wide: true }));
assert.match(html, /grid-cols-5/); assert.doesNotMatch(html, /All stations/);
// ---- Head unit view ----
store.clear(); store.set(RADIO_PRESETS_KEY, '[]');
let unit = renderToStaticMarkup(createElement(RadioPresetsBar, { station: null, live: false, onPlay: noop, initialView: 'unit' }));
assert.equal((unit.match(/data-testid="radio-preset-[1-5]"/g) ?? []).length, 5);
assert.equal((unit.match(/data-testid="radio-preset-bank"/g) ?? []).length, 1);
assert.equal((unit.match(/<[a-z]+\s[^>]*data-testid="radio-head-unit-knob"/g) ?? []).length, 1); // elements only: the inline <style> focus rule also names this testid
assert.match(unit, /data-testid="radio-head-unit-prev"/);
assert.match(unit, /data-testid="radio-head-unit-next"/);
assert.match(unit, /AJN-1/); assert.doesNotMatch(unit, /JVC|\bCD\b|SiriusXM|Math\.random/);
assert.match(unit, /OFF AIR/); assert.doesNotMatch(unit, /ON AIR/);
unit = renderToStaticMarkup(createElement(RadioPresetsBar, { station: playingNow, live: true, onPlay: noop, initialView: 'unit' }));
assert.match(unit, /ON AIR/); assert.doesNotMatch(unit, /OFF AIR/); assert.match(unit, /Station b/);
// wall is still the default
assert.doesNotMatch(renderToStaticMarkup(createElement(RadioPresetsBar, { station: null, live: false, onPlay: noop })), /<[a-z]+\s[^>]*data-testid="radio-head-unit/);
// remembered view: blocked / missing / junk storage falls back to wall
const { readPresetView, PRESET_VIEW_KEY } = await import('./src/components/RadioPresetsBar');
assert.equal(readPresetView({ getItem: () => 'unit' }), 'unit');
assert.equal(readPresetView({ getItem: () => 'junk' }), 'wall');
assert.equal(readPresetView({ getItem: () => { throw new Error('blocked'); } }), 'wall');
assert.equal(PRESET_VIEW_KEY, 'ajn.radio.presetView.v1');
// the app asks for the head unit by default; a stored choice always wins
assert.equal(readPresetView({ getItem: () => null }, 'unit'), 'unit');
assert.equal(readPresetView({ getItem: () => 'wall' }, 'unit'), 'wall');
assert.equal(readPresetView({ getItem: () => { throw new Error('blocked'); } }, 'unit'), 'unit');
assert.match(renderToStaticMarkup(createElement(RadioPresetsBar, { station: null, live: false, onPlay: noop, defaultView: 'unit' })), /<[a-z]+\s[^>]*data-testid="radio-head-unit/);
console.log('PASS radio presets: store rules, refusals, bad data, injectable storage, bar markup (5 slots, empty, filled, active, paused, non-radio, wall, banks, wide, head unit)');
