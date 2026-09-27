/* Rush playback preference, versioned. Only the preference is stored — never
 * playback position, media URLs or resolver results.
 *  v1: { version: 1, continueAcrossDates: boolean }  (default: true) */
export const RUSH_SETTINGS_KEY = 'ajn.rush.settings.v1';
export const RUSH_SETTINGS_EVENT = 'ajn-rush-settings';
export interface RushSettings { continueAcrossDates: boolean }
export const DEFAULT_RUSH_SETTINGS: RushSettings = { continueAcrossDates: true };

export function parseRushSettings(raw: string | null): RushSettings {
  try {
    const d = raw ? JSON.parse(raw) : null;
    if (d && d.version === 1 && typeof d.continueAcrossDates === 'boolean') return { continueAcrossDates: d.continueAcrossDates };
  } catch { /* corrupt: defaults */ }
  return { ...DEFAULT_RUSH_SETTINGS };
}

export function loadRushSettings(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): RushSettings {
  try { return parseRushSettings(storage?.getItem(RUSH_SETTINGS_KEY) ?? null); } catch { return { ...DEFAULT_RUSH_SETTINGS }; }
}

/** Returns false when storage is unavailable or full (the choice then lasts this session). */
export function saveRushSettings(s: RushSettings, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): boolean {
  let ok = true;
  try { storage?.setItem(RUSH_SETTINGS_KEY, JSON.stringify({ version: 1, continueAcrossDates: s.continueAcrossDates })); } catch { ok = false; }
  try { globalThis.dispatchEvent?.(new CustomEvent(RUSH_SETTINGS_EVENT, { detail: s })); } catch { /* no DOM */ }
  return ok;
}
