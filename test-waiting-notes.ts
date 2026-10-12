import assert from 'node:assert/strict';
import data from './src/data/waitingNotes.json' with { type: 'json' };
import { createDeck, mulberry32, waitKindOf, type WaitingNotesData } from './src/utils/waitingNotes.ts';
const D = data as unknown as WaitingNotesData;

// 1. JSON is well-formed and every line is short, plain, unique, and never claims success
const all = [...D.themes.flatMap((t) => t.lines), ...D.slow, ...D.quotes];
assert.ok(D.themes.length >= 6 && D.themes.flatMap((t) => t.lines).length >= 60 && D.quotes.length >= 10);
assert.equal(new Set(all).size, all.length, 'no duplicate notes');
for (const l of all) { assert.ok(l.length <= 96, `too long (${l.length}): ${l}`); assert.ok(!/\b(ready|fixed|connected|success|done|playing now)\b/i.test(l.replace(/the show is ready|when the show is ready/i, '')), `claims success: ${l}`); }
for (const t of D.themes) assert.ok(t.emoji && t.id && t.label && t.lines.length >= 5, t.id);
const shorts = Object.values(D.acronyms).flat().map((a) => a.short); assert.equal(new Set(shorts).size, shorts.length, 'unique acronyms');
for (const a of Object.values(D.acronyms).flat()) assert.match(a.short, /^[A-Z](\.[A-Z])*\.?$/, a.short);
for (const k of ['loading', 'seeking', 'buffering', 'stalled']) assert.ok(D.kinds[k], k);
assert.ok(D.settings.showAfterMs >= 1000 && D.settings.retryAfterMs > D.settings.slowAfterMs);

// 2. statuses map to wait kinds; successes/errors do not
assert.equal(waitKindOf('Seeking…'), 'seeking'); assert.equal(waitKindOf('Network stalled…'), 'stalled'); assert.equal(waitKindOf('Buffering…'), 'buffering');
assert.equal(waitKindOf('Reconnecting… (1/3)'), 'buffering'); assert.equal(waitKindOf('Loading… (resolving the redirect chain on the server)'), 'loading'); assert.equal(waitKindOf('Starting playback…'), 'loading');
for (const s of ['Playing', 'Ready to play', 'Failed to load — x', 'Unavailable', 'Offline — will resume when the connection returns', '']) assert.equal(waitKindOf(s), null, s);

// 3. deck: no immediate repeats over a long run, every line used before reuse, deterministic per seed
const lines = D.themes.flatMap((t) => t.lines).length;
const run = (seed: number, n: number, el = 0) => { const d = createDeck(D, mulberry32(seed)); return Array.from({ length: n }, () => d.next(el)); };
const a = run(7, 400); for (let i = 1; i < a.length; i++) assert.notEqual(a[i].text, a[i - 1].text, 'no immediate repeat');
assert.deepEqual(run(7, 50).map((n) => n.text), run(7, 50).map((n) => n.text), 'same seed, same order');
assert.notDeepEqual(run(7, 50).map((n) => n.text), run(8, 50).map((n) => n.text), 'different seed differs');
const first = run(3, 60).filter((n) => n.kind === 'line').slice(0, lines).map((n) => n.text); assert.equal(new Set(first).size, first.length, 'a full pass uses each line once');
assert.ok(a.some((n) => n.kind === 'quote') && !a.some((n) => n.kind === 'slow'), 'quotes appear; slow notes only when slow');
assert.ok(run(5, 40, 20000).some((n) => n.kind === 'slow'), 'slow notes appear after slowAfterMs');
const themesSeen = new Set(run(11, 30).map((n) => n.theme)); assert.ok(themesSeen.size >= 5, 'themes are mixed');
const d = createDeck(D, mulberry32(1)); const acr = Array.from({ length: 12 }, () => d.acronym('seeking').short); for (let i = 1; i < acr.length; i++) assert.notEqual(acr[i], acr[i - 1]);
console.log('waiting notes: all passed');
