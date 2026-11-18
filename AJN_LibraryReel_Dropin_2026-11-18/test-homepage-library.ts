import assert from 'node:assert/strict';
import { buildCaptures, parseCaptureName, MIN_CAPTURE_BYTES, ID_RE } from './server/homepageLibrary.ts';
import {
  formatDateLine, isInfowarsAudio, emptyHistory, commitShown, stepBack, stepForward, canGoBack, canGoForwardInHistory, currentOf,
  pickCandidate, zoomIn, zoomOut, MAX_HISTORY, imageUrl,
} from './src/library-reel/reelLogic.ts';
import { playerKeyAction } from './src/utils/playerKeys.ts';

// ── server filter ────────────────────────────────────────────────────────────
const n = (t: string) => `infowars-2025-${t}.jpg`;
assert.equal(parseCaptureName(n('06-10T06:59:00.123456-05:00')), '20250610T065900-0500');
assert.equal(parseCaptureName('infowars-2025-06-10T06:59:00.1-05:00.fullpage.jpg'), null, 'fullpage is never used');
assert.equal(parseCaptureName('infowars-2025-06-10T06:59:00.1-05:00_thumb.jpg'), null, 'thumb is never used');
assert.equal(parseCaptureName('infowars-2025-06-10T06:59:00.1-05:00.lighthouse.json'), null);
const files = [
  { name: n('06-10T06:59:00.1-05:00'), size: '297853' },
  { name: n('06-10T06:59:00.9-05:00'), size: '297900' },          // same capture second: deduped
  { name: n('06-11T06:00:00.1-05:00'), size: String(MIN_CAPTURE_BYTES - 1) }, // too small: blank/challenge page
  { name: n('06-12T06:00:00.1-05:00'), size: String(MIN_CAPTURE_BYTES) },     // exactly at the screening line: kept
  { name: n('06-13T06:00:00.1-05:00'), size: '300000', private: 'true' },     // restricted: skipped
  { name: n('06-14T06:00:00.1-05:00'), size: 'x' },                           // unreadable size: skipped
  { name: 'infowars-2025-06-15T06:00:00.1-05:00.fullpage.jpg', size: '7000000' },
];
const caps = buildCaptures('infowars-2025', files);
assert.deepEqual(caps.map((c) => c.id), ['20250610T065900-0500', '20250612T060000-0500']);
for (const c of caps) assert.ok(ID_RE.test(c.id));

// ── caption ──────────────────────────────────────────────────────────────────
assert.equal(formatDateLine('20250610T065900-0500'), '10 Jun 2025 - 6:59 am UTC-05:00');
assert.equal(formatDateLine('20250101T000500+0000'), '1 Jan 2025 - 12:05 am UTC+00:00');
assert.equal(formatDateLine('20251231T235900-0600'), '31 Dec 2025 - 11:59 pm UTC-06:00');
assert.equal(formatDateLine('20251301T000000-0500'), null);
assert.equal(formatDateLine('<img onerror=x>'), null, 'anything that is not a capture id gets no caption');
assert.ok(!/archive/i.test(imageUrl('20250610T065900-0500')), 'no archive wording in anything the browser sees');

// ── who gets the preview ─────────────────────────────────────────────────────
assert.equal(isInfowarsAudio({ channelId: 'archive-infowars-radio', mediaType: 'audio' }), true);
assert.equal(isInfowarsAudio({ channelId: 'radio:ajn-infowars-live-aac' }), true);
assert.equal(isInfowarsAudio({ archivePath: '/download/The_Alex_Jones_Radio_Show_20240101_000000/a.mp3' }), true);
assert.equal(isInfowarsAudio({ channelId: 'archive-infowars-radio', mediaType: 'video' }), false);
assert.equal(isInfowarsAudio({ channelId: 'rush-vod' }), false);
assert.equal(isInfowarsAudio(undefined), false);

// ── history / shuffle ────────────────────────────────────────────────────────
let h = emptyHistory();
assert.equal(currentOf(h), null);
h = commitShown(h, 'a'); h = commitShown(h, 'b'); h = commitShown(h, 'c');
assert.equal(currentOf(h), 'c'); assert.ok(canGoBack(h)); assert.ok(!canGoForwardInHistory(h));
h = stepBack(h); assert.equal(currentOf(h), 'b'); assert.ok(canGoForwardInHistory(h));
h = stepForward(h); assert.equal(currentOf(h), 'c');
h = stepBack(stepBack(h)); assert.equal(currentOf(h), 'a'); assert.ok(!canGoBack(h));
h = commitShown(h, 'z'); assert.deepEqual(h.items, ['a', 'z'], 'a new capture drops the forward part');
let big = emptyHistory();
for (let i = 0; i < MAX_HISTORY + 25; i += 1) big = commitShown(big, `i${i}`);
assert.equal(big.items.length, MAX_HISTORY); assert.equal(currentOf(big), `i${MAX_HISTORY + 24}`);
const ids = ['a', 'b', 'c'];
for (let i = 0; i < 200; i += 1) assert.notEqual(pickCandidate(ids, 'a', new Set()), 'a', 'never the same capture twice in a row');
assert.equal(pickCandidate(['a'], 'a', new Set()), null);
assert.equal(pickCandidate(ids, null, new Set(ids)), null, 'failed candidates are not retried this round');
assert.equal(pickCandidate(ids, 'a', new Set(['b']), () => 0.99), 'c');

// ── zoom ─────────────────────────────────────────────────────────────────────
assert.equal(zoomIn(100), 125); assert.equal(zoomOut(100), 75); assert.equal(zoomIn(300), 300); assert.equal(zoomOut(25), 25);

// ── keyboard ownership: nothing typed inside the viewer reaches the player ──
const base = { ctrlKey: false, altKey: false, metaKey: false, shiftKey: false };
for (const key of [' ', 'k', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'm', 'j', 'l']) {
  assert.equal(playerKeyAction({ ...base, key, inModal: true }), null, `${key} inside the viewer is ignored by the player`);
}
assert.equal(playerKeyAction({ ...base, key: 'ArrowRight' }), 'seek-forward', 'outside the viewer nothing changed');
assert.equal(playerKeyAction({ ...base, key: ' ' }), 'toggle-play');
console.log('homepage library tests passed');
