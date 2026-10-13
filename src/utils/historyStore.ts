/* Watch/listen history — the long-term log behind the History page. (Recently Played stays the short resume list of 5.)
 * One entry per item, newest play first; replaying moves it to the top and bumps `plays`. Versioned for future migration. */
import type { NowPlayingMedia } from '../types';
export const HISTORY_STORAGE_KEY = 'ajn.history.v1';
export const HISTORY_LIMIT = 500;

/** `updatedAt` = last time ANY field changed (play or resume position); cloud sync merges on it. Absent on old entries → playedAt. */
export interface HistoryEntry extends NowPlayingMedia { id: string; playedAt: number; progressSeconds: number; plays: number; updatedAt?: number }
export interface HistoryDayGroup { key: string; label: string; entries: HistoryEntry[] }

const clean = (m: NowPlayingMedia): NowPlayingMedia => {
  const { startAtSeconds, restoredPaused, ...rest } = m; // one-shot flags are never persisted
  void startAtSeconds; void restoredPaused;
  return rest;
};

export function recordPlay(entries: HistoryEntry[], id: string, media: NowPlayingMedia, now: number, progressSeconds = 0): HistoryEntry[] {
  if (!id || !media?.src || !media.title) return entries;
  const prev = entries.find((e) => e.id === id);
  const entry: HistoryEntry = { ...clean(media), id, playedAt: now, updatedAt: now, progressSeconds: prev?.progressSeconds ?? progressSeconds, plays: (prev?.plays ?? 0) + 1 };
  return [entry, ...entries.filter((e) => e.id !== id)].slice(0, HISTORY_LIMIT);
}
export function updateHistoryProgress(entries: HistoryEntry[], id: string, seconds: number, now: number = Date.now()): HistoryEntry[] {
  if (!Number.isFinite(seconds) || seconds < 0) return entries;
  let changed = false;
  const next = entries.map((e) => { if (e.id !== id || e.progressSeconds === seconds) return e; changed = true; return { ...e, progressSeconds: seconds, updatedAt: now }; });
  return changed ? next : entries; // does NOT touch playedAt: scrubbing must not reorder history
}
export const removeHistoryEntry = (entries: HistoryEntry[], id: string): HistoryEntry[] => entries.filter((e) => e.id !== id);

export function normalizeHistory(value: unknown): HistoryEntry[] {
  const raw = value && typeof value === 'object' && !Array.isArray(value) && (value as any).version === 1 ? (value as any).items : null;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw
    .filter((e: any) => e && typeof e.id === 'string' && typeof e.src === 'string' && typeof e.title === 'string' && Number.isFinite(e.playedAt))
    .map((e: any): HistoryEntry => ({ ...e, progressSeconds: Number.isFinite(e.progressSeconds) && e.progressSeconds >= 0 ? e.progressSeconds : 0, plays: Number.isFinite(e.plays) && e.plays > 0 ? e.plays : 1 }))
    .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .sort((a, b) => b.playedAt - a.playedAt)
    .slice(0, HISTORY_LIMIT);
}
export function loadHistory(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): HistoryEntry[] {
  try { return normalizeHistory(JSON.parse(storage?.getItem(HISTORY_STORAGE_KEY) ?? 'null')); } catch { return []; }
}
/** false when storage is unavailable/full — history then lasts for this session only. */
export function saveHistory(entries: HistoryEntry[], storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): boolean {
  try { storage?.setItem(HISTORY_STORAGE_KEY, JSON.stringify({ version: 1, items: entries })); return true; } catch { return false; }
}

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Groups newest-first entries by LOCAL calendar day. `now` is injected so tests don't depend on the clock. */
export function groupByDay(entries: HistoryEntry[], now: number): HistoryDayGroup[] {
  const today = new Date(now); const yest = new Date(now); yest.setDate(yest.getDate() - 1);
  const groups: HistoryDayGroup[] = [];
  for (const e of entries) {
    const d = new Date(e.playedAt); const key = dayKey(d);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      const label = key === dayKey(today) ? 'Today' : key === dayKey(yest) ? 'Yesterday'
        : d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' as const } : {}) });
      g = { key, label, entries: [] }; groups.push(g);
    }
    g.entries.push(e);
  }
  return groups;
}
export function filterHistory(entries: HistoryEntry[], q: string, type: 'all' | 'audio' | 'video'): HistoryEntry[] {
  const needle = q.trim().toLowerCase();
  return entries.filter((e) => (type === 'all' || (e.mediaType ?? 'video') === type)
    && (!needle || `${e.title} ${e.subtitle ?? ''} ${e.channelName ?? ''}`.toLowerCase().includes(needle)));
}
