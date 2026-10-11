/* Favorites for anything playable (the Heart in the player). Separate from the Library's id-only star list
 * (utils/favoritesStore.ts), which stays as is. Stores enough to replay without a lookup. */
import type { NowPlayingMedia } from '../types';
export const MEDIA_FAVORITES_KEY = 'ajn.favorites.media.v1';
export const MEDIA_FAVORITES_LIMIT = 200;
export interface FavoriteMedia extends NowPlayingMedia { id: string; savedAt: number }

const clean = (m: NowPlayingMedia): NowPlayingMedia => { const { startAtSeconds, restoredPaused, ...rest } = m; void startAtSeconds; void restoredPaused; return rest; };

export const isFavorite = (list: FavoriteMedia[], id: string): boolean => list.some((f) => f.id === id);
/** Adds (newest first) or removes. A full list refuses a new item instead of silently dropping an old favorite. */
export function toggleFavorite(list: FavoriteMedia[], id: string, media: NowPlayingMedia, now: number): { list: FavoriteMedia[]; added: boolean; full: boolean } {
  if (isFavorite(list, id)) return { list: list.filter((f) => f.id !== id), added: false, full: false };
  if (!id || !media?.src || !media.title) return { list, added: false, full: false };
  if (list.length >= MEDIA_FAVORITES_LIMIT) return { list, added: false, full: true };
  return { list: [{ ...clean(media), id, savedAt: now }, ...list], added: true, full: false };
}
export function normalizeFavorites(value: unknown): FavoriteMedia[] {
  const raw = value && typeof value === 'object' && !Array.isArray(value) && (value as any).version === 1 ? (value as any).items : null;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.filter((e: any) => e && typeof e.id === 'string' && typeof e.src === 'string' && typeof e.title === 'string')
    .map((e: any): FavoriteMedia => ({ ...e, savedAt: Number.isFinite(e.savedAt) ? e.savedAt : 0 }))
    .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .sort((a, b) => b.savedAt - a.savedAt).slice(0, MEDIA_FAVORITES_LIMIT);
}
export function loadMediaFavorites(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): FavoriteMedia[] {
  try { return normalizeFavorites(JSON.parse(storage?.getItem(MEDIA_FAVORITES_KEY) ?? 'null')); } catch { return []; }
}
export function saveMediaFavorites(list: FavoriteMedia[], storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): boolean {
  try { storage?.setItem(MEDIA_FAVORITES_KEY, JSON.stringify({ version: 1, items: list })); return true; } catch { return false; }
}
