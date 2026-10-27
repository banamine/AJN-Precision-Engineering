/* Rush playback preference, versioned. Only the preference is stored — never
 * playback position, media URLs or resolver results.
 *  v1: { version: 1, continueAcrossDates: boolean }  (default: true) */
export const RUSH_SETTINGS_KEY = 'ajn.rush.settings.v1';
export const RUSH_SETTINGS_EVENT = 'ajn-rush-settings';
export const RUSH_PRELUDE_SEEN_PREFIX = 'ajn-rush-prelude-seen-';
export const RUSH_PRELUDE_SEEN_EVENT = 'ajn-rush-prelude-seen';
export interface RushSettings { continueAcrossDates: boolean }
export const DEFAULT_RUSH_SETTINGS: RushSettings = { continueAcrossDates: true };

function safeLocalStorage(): Storage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

export function parseRushSettings(raw: string | null): RushSettings {
  try {
    const d = raw ? JSON.parse(raw) : null;
    if (d && d.version === 1 && typeof d.continueAcrossDates === 'boolean') return { continueAcrossDates: d.continueAcrossDates };
  } catch { /* corrupt: defaults */ }
  return { ...DEFAULT_RUSH_SETTINGS };
}

export function loadRushSettings(storage?: Pick<Storage, 'getItem'>): RushSettings {
  try { return parseRushSettings((storage ?? safeLocalStorage())?.getItem(RUSH_SETTINGS_KEY) ?? null); } catch { return { ...DEFAULT_RUSH_SETTINGS }; }
}

/** Returns false when storage is unavailable or full (the choice then lasts this session). */
export function saveRushSettings(s: RushSettings, storage?: Pick<Storage, 'setItem'>): boolean {
  let ok = true;
  try {
    const target = storage ?? safeLocalStorage();
    if (!target) ok = false;
    else target.setItem(RUSH_SETTINGS_KEY, JSON.stringify({ version: 1, continueAcrossDates: s.continueAcrossDates }));
  } catch { ok = false; }
  try { globalThis.dispatchEvent?.(new CustomEvent(RUSH_SETTINGS_EVENT, { detail: s })); } catch { /* no DOM */ }
  return ok;
}

/** Date is intentionally viewer-local, not UTC or the selected program date. */
export function rushPreludeSeenKey(now = new Date()): string {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `${RUSH_PRELUDE_SEEN_PREFIX}${date}`;
}

export function hasSeenRushPreludeToday(storage?: Pick<Storage, 'getItem'>, now = new Date()): boolean {
  try { return (storage ?? safeLocalStorage())?.getItem(rushPreludeSeenKey(now)) === '1'; } catch { return false; }
}

/** Called only from the player's first native `playing` event for the prelude. */
export function markRushPreludeSeenToday(storage?: Pick<Storage, 'setItem'>, now = new Date()): boolean {
  try {
    const target = storage ?? safeLocalStorage();
    if (!target) return false;
    target.setItem(rushPreludeSeenKey(now), '1');
    try { globalThis.dispatchEvent?.(new Event(RUSH_PRELUDE_SEEN_EVENT)); } catch { /* no DOM */ }
    return true;
  } catch { return false; }
}
