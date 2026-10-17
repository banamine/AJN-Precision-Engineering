/* Remembers, per guide, which category chip and "On now" switch the viewer last used, so coming back to the guide
 * (or reloading the app) shows the same list. Search text is deliberately NOT remembered. Pure + storage-injectable. */
export const FILTER_PREFS_KEY = 'ajn.epg.filters.v1';
export interface FilterPrefs { category: string; onNow: boolean }
export interface PrefsStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
const DEFAULT: FilterPrefs = { category: 'all', onNow: false };

function store(storage?: PrefsStorage): PrefsStorage | null {
  try { return storage ?? (typeof window === 'undefined' ? null : window.localStorage); } catch { return null; }
}
function readAll(s: PrefsStorage): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(s.getItem(FILTER_PREFS_KEY) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch { return {}; }
}

export function loadFilterPrefs(guideId: string, storage?: PrefsStorage): FilterPrefs {
  const s = store(storage);
  if (!s) return { ...DEFAULT };
  try {
    const e = readAll(s)[guideId];
    if (!e || typeof e !== 'object') return { ...DEFAULT };
    const r = e as Record<string, unknown>;
    return { category: typeof r.category === 'string' && r.category ? r.category : 'all', onNow: r.onNow === true };
  } catch { return { ...DEFAULT }; }
}

export function saveFilterPrefs(guideId: string, prefs: FilterPrefs, storage?: PrefsStorage): void {
  const s = store(storage);
  if (!s) return;
  try {
    const all = readAll(s);
    if (prefs.category === 'all' && !prefs.onNow) delete all[guideId]; else all[guideId] = { category: prefs.category, onNow: prefs.onNow };
    s.setItem(FILTER_PREFS_KEY, JSON.stringify(all));
  } catch { /* storage unavailable: filters just last for this visit */ }
}
