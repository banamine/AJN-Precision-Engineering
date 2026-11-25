import assert from 'node:assert/strict';
import { suggest, highlightParts, nextActiveIndex, addRecentSearch, normalizeQuery, SUGGEST_MIN_CHARS } from './src/utils/suggest.ts';
import { recordPlay, updateHistoryProgress, groupByDay, filterHistory, normalizeHistory, saveHistory, loadHistory, HISTORY_LIMIT, HISTORY_STORAGE_KEY } from './src/utils/historyStore.ts';
import { toggleFavorite, isFavorite, normalizeFavorites, saveMediaFavorites, loadMediaFavorites, MEDIA_FAVORITES_LIMIT } from './src/utils/mediaFavorites.ts';
import { playerKeyAction, seekDelta } from './src/utils/playerKeys.ts';

// ── suggest: two-keystroke threshold, ranking, accents, dedupe
const C = ['Supreme Court rulings', 'The Economy Today', 'Economy', 'Café Society', 'Space race', 'Foreign Policy'].map((text) => ({ text }));
assert.equal(SUGGEST_MIN_CHARS, 2);
assert.deepEqual(suggest('e', C), [], '1 char → nothing');
assert.deepEqual(suggest(' e ', C), [], 'whitespace does not count');
assert.deepEqual(suggest('ec', C).map((s) => s.text), ['Economy', 'The Economy Today'], 'prefix outranks word-start');
assert.deepEqual(suggest('cafe', C).map((s) => s.text), ['Café Society'], 'accent-insensitive');
assert.deepEqual(suggest('ourt', C).map((s) => s.text), ['Supreme Court rulings'], 'substring match (rank 1)');
assert.deepEqual(suggest('economy', C).map((s) => s.text), ['The Economy Today'], 'exact typed text is not re-offered');
assert.equal(suggest('co', [...C, ...C]).length, new Set(suggest('co', [...C, ...C]).map((s) => s.text)).size, 'deduped');
assert.equal(suggest('s', C, 8).length, 0);
assert.ok(suggest('po', C, 1).length <= 1, 'limit honoured');
// ── highlight
const h = highlightParts('Café Society', 'cafe');
assert.deepEqual(h, [{ text: 'Café', match: true }, { text: ' Society', match: false }], 'accented letters highlighted whole');
assert.equal(highlightParts('The Economy Today', 'econ today').filter((p) => p.match).map((p) => p.text).join('|'), 'Econ|Today');
assert.equal(highlightParts('abc', 'zz').length, 1);
assert.equal(highlightParts('abc', 'zz')[0].match, false);
assert.equal(highlightParts('a<b>&c', 'b>').map((p) => p.text).join(''), 'a<b>&c', 'text preserved verbatim (render as text, not HTML)');
assert.equal(normalizeQuery('  É  C '), 'e c');
// ── keyboard model
assert.equal(nextActiveIndex('ArrowDown', -1, 3), 0);
assert.equal(nextActiveIndex('ArrowDown', 2, 3), 0, 'wraps');
assert.equal(nextActiveIndex('ArrowUp', -1, 3), 2);
assert.equal(nextActiveIndex('ArrowUp', 0, 3), 2);
assert.equal(nextActiveIndex('ArrowDown', -1, 0), null);
assert.equal(nextActiveIndex('a', 0, 3), null);
assert.deepEqual(addRecentSearch(['Space'], 'space '), ['space'], 'case-insensitive dedupe, newest spelling kept');
assert.deepEqual(addRecentSearch(['a1'], 'x'), ['a1'], 'under 2 chars not saved');

// ── history
const m = (n: string) => ({ src: `/p/${n}.mp4`, title: n, mediaType: 'video' as const });
let hist = recordPlay([], 'a', m('A'), 1000);
hist = recordPlay(hist, 'b', m('B'), 2000);
hist = updateHistoryProgress(hist, 'a', 42);
assert.deepEqual(hist.map((e) => e.id), ['b', 'a'], 'progress update does not reorder');
hist = recordPlay(hist, 'a', { ...m('A'), startAtSeconds: 42, restoredPaused: true }, 3000);
assert.deepEqual(hist.map((e) => [e.id, e.plays, e.progressSeconds]), [['a', 2, 42], ['b', 1, 0]], 'replay moves to top, bumps plays, keeps progress');
assert.ok(!('startAtSeconds' in hist[0]) && !('restoredPaused' in hist[0]), 'one-shot flags never persisted');
assert.equal(recordPlay(hist, '', m('X'), 1).length, 2, 'empty id refused');
assert.equal(recordPlay([], 'z', { src: '', title: 't' }, 1).length, 0, 'no src refused');
let big: any[] = []; for (let i = 0; i < HISTORY_LIMIT + 20; i++) big = recordPlay(big, `i${i}`, m(`T${i}`), i);
assert.equal(big.length, HISTORY_LIMIT); assert.equal(big[0].id, `i${HISTORY_LIMIT + 19}`);
const noon = (d: number) => new Date(2026, 9, d, 12, 0, 0).getTime();
const days = groupByDay(recordPlay(recordPlay(recordPlay([], 'o', m('O'), noon(1)), 'y', m('Y'), noon(10)), 't', m('T'), noon(11)), noon(11));
assert.deepEqual(days.map((g) => g.label).slice(0, 2), ['Today', 'Yesterday']);
assert.equal(days.length, 3); assert.equal(days[0].entries[0].id, 't');
assert.equal(filterHistory(hist, 'b', 'all').length, 1);
assert.equal(filterHistory([{ ...hist[0], mediaType: 'audio' }, hist[1]], '', 'audio').length, 1);
assert.deepEqual(normalizeHistory('garbage'), []); assert.deepEqual(normalizeHistory({ version: 2, items: [] }), []);
assert.equal(normalizeHistory({ version: 1, items: [hist[0], hist[0], { id: 1 }] }).length, 1, 'dupes + malformed dropped');
const mem = new Map<string, string>(); const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
assert.equal(saveHistory(hist, st), true); assert.deepEqual(loadHistory(st).map((e) => e.id), ['a', 'b']);
mem.set(HISTORY_STORAGE_KEY, '{bad'); assert.deepEqual(loadHistory(st), []);
assert.equal(saveHistory(hist, { setItem: () => { throw new Error('Quota'); } }), false);

// ── media favorites
let fav = toggleFavorite([], 'a', m('A'), 5);
assert.equal(fav.added, true); assert.ok(isFavorite(fav.list, 'a'));
fav = toggleFavorite(fav.list, 'b', m('B'), 6); assert.deepEqual(fav.list.map((f) => f.id), ['b', 'a']);
const off = toggleFavorite(fav.list, 'a', m('A'), 7); assert.equal(off.added, false); assert.deepEqual(off.list.map((f) => f.id), ['b']);
assert.equal(toggleFavorite([], 'x', { src: '', title: '' }, 1).list.length, 0);
let full: any[] = []; for (let i = 0; i < MEDIA_FAVORITES_LIMIT; i++) full = toggleFavorite(full, `f${i}`, m(`F${i}`), i).list;
const over = toggleFavorite(full, 'new', m('N'), 9999); assert.equal(over.full, true); assert.equal(over.list.length, MEDIA_FAVORITES_LIMIT, 'full list refuses, never silently evicts');
assert.deepEqual(normalizeFavorites(null), []);
assert.equal(saveMediaFavorites(fav.list, st), true); assert.deepEqual(loadMediaFavorites(st).map((f) => f.id), ['b', 'a']);

// ── player keys
const K = (key: string, o: any = {}) => playerKeyAction({ key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, targetTag: 'BODY', ...o });
assert.equal(K(' '), 'toggle-play'); assert.equal(K('m'), 'toggle-mute'); assert.equal(K('M'), 'toggle-mute');
assert.equal(K('ArrowLeft'), 'seek-back'); assert.equal(K('ArrowRight'), 'seek-forward');
assert.equal(K(' ', { targetTag: 'BUTTON' }), null, 'Space on a focused button = that button (no double toggle)');
assert.equal(K('m', { targetTag: 'BUTTON' }), 'toggle-mute', 'M still works after clicking a player button');
assert.equal(K('ArrowRight', { targetTag: 'BUTTON' }), 'seek-forward');
assert.equal(K(' ', { targetTag: 'INPUT' }), null); assert.equal(K('m', { targetTag: 'INPUT' }), null, 'typing "m" in a field never mutes');
assert.equal(K('ArrowLeft', { targetTag: 'INPUT', targetType: 'range' }), null, 'sliders keep their own arrows');
assert.equal(K('m', { editable: true }), null); assert.equal(K('m', { targetTag: 'TEXTAREA' }), null);
assert.equal(K('m', { ctrlKey: true }), null); assert.equal(K('ArrowLeft', { altKey: true }), null, 'Alt+Left (browser back) untouched');
assert.equal(K(' ', { defaultPrevented: true }), null); assert.equal(K('x'), null);
assert.equal(seekDelta('seek-back', 'ArrowLeft', false), -10); assert.equal(seekDelta('seek-forward', 'ArrowRight', true), 30); assert.equal(seekDelta('seek-forward', 'l', false), 30);
console.log('search/history/favorites/keys: all passed');
