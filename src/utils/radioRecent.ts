/* The stations the viewer played most recently (for the Radio button's long-press quick menu).
 * Stored on this device only. Pure functions + injectable storage so they can be tested without a browser. */
export const RADIO_RECENT_KEY = 'ajn.radio.recent.v1';
export const RADIO_RECENT_MAX = 8;
export interface RecentStation { channelId: string; src: string; title: string; subtitle?: string; programId?: string; guideId?: string }
export interface RecentStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
function store(s?: RecentStorage): RecentStorage | null {
  try { return s ?? (typeof window === 'undefined' ? null : window.localStorage); } catch { return null; }
}

export function readRecentStations(storage?: RecentStorage): RecentStation[] {
  const s = store(storage);
  if (!s) return [];
  try {
    const raw: unknown = JSON.parse(s.getItem(RADIO_RECENT_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    const out: RecentStation[] = [];
    for (const r of raw) {
      if (!r || typeof r !== 'object') continue;
      const o = r as Record<string, unknown>;
      if (!isStr(o.channelId) || !o.channelId.startsWith('radio:') || !isStr(o.src) || !isStr(o.title)) continue;
      out.push({ channelId: o.channelId, src: o.src, title: o.title, subtitle: isStr(o.subtitle) ? o.subtitle : undefined, programId: isStr(o.programId) ? o.programId : undefined, guideId: isStr(o.guideId) ? o.guideId : undefined });
    }
    return out.slice(0, RADIO_RECENT_MAX);
  } catch { return []; }
}

/** Newest first, no duplicates, at most RADIO_RECENT_MAX. Anything that is not a radio station is ignored. */
export function recordRecentStation(st: RecentStation, storage?: RecentStorage): RecentStation[] {
  if (!isStr(st.channelId) || !st.channelId.startsWith('radio:') || !isStr(st.src) || !isStr(st.title)) return readRecentStations(storage);
  const next = [st, ...readRecentStations(storage).filter((r) => r.channelId !== st.channelId)].slice(0, RADIO_RECENT_MAX);
  const s = store(storage);
  try { s?.setItem(RADIO_RECENT_KEY, JSON.stringify(next)); } catch { /* storage full or blocked: the menu just starts empty next visit */ }
  return next;
}
