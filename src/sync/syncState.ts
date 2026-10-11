/* Small persisted bookkeeping for sync: removal tombstones, the Clear-history watermark, and the user's settings. */
import type { Tombs } from './syncMerge';
export const SYNC_LOCAL_KEY = 'ajn.sync.local.v1';
export const SYNC_SETTINGS_KEY = 'ajn.sync.settings.v1';
export const TOMB_LIMIT = 500;

export interface SyncLocalState { favTombs: Tombs; histTombs: Tombs; historyClearedAt: number; lastSyncAt: number }
export interface SyncSettings { historySync: boolean }
export const emptyLocalState = (): SyncLocalState => ({ favTombs: {}, histTombs: {}, historyClearedAt: 0, lastSyncAt: 0 });

const cleanTombs = (v: unknown): Tombs => {
  const out: Tombs = {};
  if (v && typeof v === 'object') for (const [k, ts] of Object.entries(v as Record<string, unknown>)) if (typeof ts === 'number' && Number.isFinite(ts)) out[k] = ts;
  return out;
};
/** Keep only the newest tombstones so the map can't grow without bound. */
export function capTombs(t: Tombs, limit = TOMB_LIMIT): Tombs {
  const keys = Object.keys(t); if (keys.length <= limit) return t;
  return Object.fromEntries(keys.sort((a, b) => t[b] - t[a]).slice(0, limit).map((k) => [k, t[k]]));
}
export function parseLocalState(raw: string | null): SyncLocalState {
  try {
    const d = JSON.parse(raw ?? 'null');
    if (!d || d.version !== 1) return emptyLocalState();
    return { favTombs: cleanTombs(d.favTombs), histTombs: cleanTombs(d.histTombs), historyClearedAt: Number.isFinite(d.historyClearedAt) ? d.historyClearedAt : 0, lastSyncAt: Number.isFinite(d.lastSyncAt) ? d.lastSyncAt : 0 };
  } catch { return emptyLocalState(); }
}
export const loadLocalState = (s: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): SyncLocalState => { try { return parseLocalState(s?.getItem(SYNC_LOCAL_KEY) ?? null); } catch { return emptyLocalState(); } };
export function saveLocalState(st: SyncLocalState, s: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): boolean {
  try { s?.setItem(SYNC_LOCAL_KEY, JSON.stringify({ version: 1, ...st, favTombs: capTombs(st.favTombs), histTombs: capTombs(st.histTombs) })); return true; } catch { return false; }
}
export function loadSyncSettings(s: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): SyncSettings {
  try { const d = JSON.parse(s?.getItem(SYNC_SETTINGS_KEY) ?? 'null'); return { historySync: d?.historySync === true }; } catch { return { historySync: false }; } // History sync is OFF unless the user turned it on
}
export function saveSyncSettings(v: SyncSettings, s: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): boolean { try { s?.setItem(SYNC_SETTINGS_KEY, JSON.stringify(v)); return true; } catch { return false; } }
