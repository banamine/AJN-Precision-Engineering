/* Library Favorites persistence — versioned so the format can change later.
 *  v1: { version: 1, ids: string[] }  (ids only; the library is the source of truth)
 *  v0: a plain string[] (shipped first) — migrated on read. */
export const FAVORITES_STORAGE_KEY = 'ajn.library.favorites';
export interface FavoritesStoreV1 { version: 1; ids: string[] }

export function parseFavorites(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    const ids: unknown[] = Array.isArray(data) ? data : data && data.version === 1 && Array.isArray(data.ids) ? data.ids : [];
    return [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  } catch {
    return [];
  }
}

export function serializeFavorites(ids: Iterable<string>): string {
  const store: FavoritesStoreV1 = { version: 1, ids: [...new Set(ids)] };
  return JSON.stringify(store);
}

export function loadFavorites(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): Set<string> {
  try { return new Set(parseFavorites(storage?.getItem(FAVORITES_STORAGE_KEY) ?? null)); } catch { return new Set(); }
}

/** Returns false when storage is unavailable or full; favorites then last for this session only. */
export function saveFavorites(ids: Iterable<string>, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): boolean {
  try { storage?.setItem(FAVORITES_STORAGE_KEY, serializeFavorites(ids)); return true; } catch { return false; }
}
