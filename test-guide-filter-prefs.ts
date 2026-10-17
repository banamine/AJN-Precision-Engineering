import assert from 'node:assert/strict';
import { loadFilterPrefs, saveFilterPrefs, FILTER_PREFS_KEY, type PrefsStorage } from './src/guide/filterPrefs';

const mem = (): PrefsStorage & { data: Record<string, string> } => { const data: Record<string, string> = {}; return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } }; };

// Defaults when nothing saved, and per-guide isolation.
let s = mem();
assert.deepEqual(loadFilterPrefs('cable-tv', s), { category: 'all', onNow: false });
saveFilterPrefs('cable-tv', { category: 'news', onNow: true }, s);
saveFilterPrefs('classic-tv', { category: 'classic tv', onNow: false }, s);
assert.deepEqual(loadFilterPrefs('cable-tv', s), { category: 'news', onNow: true });
assert.deepEqual(loadFilterPrefs('classic-tv', s), { category: 'classic tv', onNow: false });
assert.deepEqual(loadFilterPrefs('live-tv', s), { category: 'all', onNow: false });
// Back to defaults removes the entry (no clutter).
saveFilterPrefs('cable-tv', { category: 'all', onNow: false }, s);
assert.ok(!('cable-tv' in JSON.parse(s.data[FILTER_PREFS_KEY])));
// Corrupt / hostile storage never throws and falls back to defaults.
for (const bad of ['not json', '[]', '"x"', '{"cable-tv":5}', '{"cable-tv":{"category":7,"onNow":"yes"}}']) {
  s = mem(); s.data[FILTER_PREFS_KEY] = bad;
  assert.deepEqual(loadFilterPrefs('cable-tv', s), { category: 'all', onNow: false }, bad);
  saveFilterPrefs('cable-tv', { category: 'news', onNow: false }, s); // can overwrite junk
  assert.equal(loadFilterPrefs('cable-tv', s).category, 'news');
}
const throwing: PrefsStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
assert.deepEqual(loadFilterPrefs('cable-tv', throwing), { category: 'all', onNow: false });
saveFilterPrefs('cable-tv', { category: 'news', onNow: true }, throwing);
console.log('[guide-filter-prefs] PASS');
