/* Watch Later: a local-only list of things to come back to. Two ways in:
 *  - manual (the bookmark button in the player), and
 *  - automatic: once you have played at least half of an item and have NOT finished it.
 * Finishing an item removes it. Never synced to the cloud (local storage only). Versioned envelope like mediaFavorites. */
import type { NowPlayingMedia } from '../types';

export const WATCH_LATER_KEY = 'ajn.watchLater.v1';
export const WATCH_LATER_LIMIT = 200;
export const AUTO_ADD_FRACTION = 0.5;
export const FINISHED_FRACTION = 0.95;
export type WatchLaterReason = 'manual' | 'auto-half';

export interface WatchLaterItem extends NowPlayingMedia {
  id: string; savedAt: number; progressSeconds: number; durationSeconds?: number; reason: WatchLaterReason;
}

/** Live radio / live streams have no timeline to come back to. */
export const isLiveItem = (m: Pick<NowPlayingMedia, 'channelId' | 'programId' | 'isLive'>): boolean =>
  Boolean(m.isLive) || String(m.channelId ?? '').startsWith('radio:') || String(m.programId ?? '').includes(':live:');

const clean = (m: NowPlayingMedia): NowPlayingMedia => { const { startAtSeconds, restoredPaused, bufferMetadata, ...rest } = m; void startAtSeconds; void restoredPaused; void bufferMetadata; return rest; };

export const isInWatchLater = (list: WatchLaterItem[], id: string): boolean => list.some((w) => w.id === id);

export type AddResult = { list: WatchLaterItem[]; added: boolean; full: boolean; live: boolean };

export function addWatchLater(list: WatchLaterItem[], id: string, media: NowPlayingMedia, now: number, opts: { reason: WatchLaterReason; progressSeconds?: number; durationSeconds?: number }): AddResult {
  if (!id || !media?.src || !media.title) return { list, added: false, full: false, live: false };
  if (isLiveItem(media)) return { list, added: false, full: false, live: true };
  const existing = list.find((w) => w.id === id);
  const progress = Number.isFinite(opts.progressSeconds) && (opts.progressSeconds as number) >= 0 ? (opts.progressSeconds as number) : 0;
  const dur = Number.isFinite(opts.durationSeconds) && (opts.durationSeconds as number) > 0 ? opts.durationSeconds : undefined;
  if (existing) { // already saved: refresh position, keep the original reason and order
    return { list: list.map((w) => (w.id === id ? { ...w, progressSeconds: progress, durationSeconds: dur ?? w.durationSeconds } : w)), added: false, full: false, live: false };
  }
  if (list.length >= WATCH_LATER_LIMIT) return { list, added: false, full: true, live: false };
  return { list: [{ ...clean(media), id, savedAt: now, progressSeconds: progress, durationSeconds: dur, reason: opts.reason }, ...list], added: true, full: false, live: false };
}
export const removeWatchLater = (list: WatchLaterItem[], id: string): WatchLaterItem[] => list.filter((w) => w.id !== id);

export type ProgressAction = 'add' | 'update' | 'remove' | 'none';
/** What a progress tick means for Watch Later. `saved` = already in the list. */
export function progressAction(position: number, duration: number, saved: boolean): ProgressAction {
  if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0 || position < 0) return 'none';
  const f = position / duration;
  if (f >= FINISHED_FRACTION || position >= duration - 5) return saved ? 'remove' : 'none';
  if (f >= AUTO_ADD_FRACTION) return saved ? 'update' : 'add';
  return 'none';
}

export function normalizeWatchLater(value: unknown): WatchLaterItem[] {
  const raw = value && typeof value === 'object' && !Array.isArray(value) && (value as any).version === 1 ? (value as any).items : null;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.filter((e: any) => e && typeof e.id === 'string' && typeof e.src === 'string' && typeof e.title === 'string')
    .map((e: any): WatchLaterItem => ({ ...e, savedAt: Number.isFinite(e.savedAt) ? e.savedAt : 0, progressSeconds: Number.isFinite(e.progressSeconds) && e.progressSeconds >= 0 ? e.progressSeconds : 0, reason: e.reason === 'auto-half' ? 'auto-half' : 'manual' }))
    .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .sort((a, b) => b.savedAt - a.savedAt).slice(0, WATCH_LATER_LIMIT);
}
export function loadWatchLater(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): WatchLaterItem[] {
  try { return normalizeWatchLater(JSON.parse(storage?.getItem(WATCH_LATER_KEY) ?? 'null')); } catch { return []; }
}
export function saveWatchLater(list: WatchLaterItem[], storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): boolean {
  try { storage?.setItem(WATCH_LATER_KEY, JSON.stringify({ version: 1, items: list })); return true; } catch { return false; }
}
