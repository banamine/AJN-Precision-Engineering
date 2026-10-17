/* Per-browser store for frames captured from real playback, used ONLY for items Archive has no image for.
 * localStorage in try/catch; if storage is unavailable everything here is a quiet no-op (the backup image still shows). */
const KEY = 'ajn.thumbs.v1';
const MISSING_KEY = 'ajn.thumbs.missing.v1';
const MAX = 150;
export const THUMB_EVENT = 'ajn:thumb-captured';

type Store = { order: string[]; map: Record<string, string> };
const empty = (): Store => ({ order: [], map: {} });
function read(): Store {
  try { const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Store | null; return s && Array.isArray(s.order) && s.map ? s : empty(); } catch { return empty(); }
}
export function getCaptured(key?: string | null): string | null { return key ? read().map[key] ?? null : null; }
export function saveCaptured(key: string, dataUrl: string): boolean {
  if (!key || !dataUrl.startsWith('data:image/jpeg;base64,') || dataUrl.length > 40_000) return false;
  try {
    const s = read();
    s.order = s.order.filter((k) => k !== key); s.order.push(key); s.map[key] = dataUrl;
    while (s.order.length > MAX) { const old = s.order.shift(); if (old) delete s.map[old]; }
    localStorage.setItem(KEY, JSON.stringify(s));
    window.dispatchEvent(new CustomEvent(THUMB_EVENT, { detail: { key } }));
    return true;
  } catch { return false; }
}
/** The <Thumb> marks an identifier when Archive had no usable image; only those are captured during playback. */
export function markMissing(key?: string | null): void {
  if (!key) return;
  try { const set = new Set<string>(JSON.parse(sessionStorage.getItem(MISSING_KEY) ?? '[]')); set.add(key); sessionStorage.setItem(MISSING_KEY, JSON.stringify([...set].slice(-300))); } catch { /* ignore */ }
}
export function needsCapture(key?: string | null): boolean {
  if (!key || getCaptured(key)) return false;
  try { return (JSON.parse(sessionStorage.getItem(MISSING_KEY) ?? '[]') as string[]).includes(key); } catch { return false; }
}
