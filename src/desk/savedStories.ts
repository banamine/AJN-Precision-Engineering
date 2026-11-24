/* Stories the listener bookmarked: kept on this device only. The whole card is stored (not just its id) so the list still works
 * after the Desk's snapshot changes. Newest first, capped. */
import type { DeskItem } from '../../server/desk';

export const SAVED_KEY = 'ajn.savedStories.v1';
export const SAVED_LIMIT = 100;

const valid = (x: any): x is DeskItem => x && typeof x.id === 'string' && typeof x.headline === 'string' && (x.cardType === 'story' || x.cardType === 'scan') && typeof x.thumbUrl === 'string';

export function loadSaved(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): DeskItem[] {
  try {
    const j = JSON.parse(storage?.getItem(SAVED_KEY) ?? 'null');
    if (!j || j.version !== 1 || !Array.isArray(j.items)) return [];
    const seen = new Set<string>();
    return j.items.filter(valid).filter((i: DeskItem) => (seen.has(i.id) ? false : (seen.add(i.id), true))).slice(0, SAVED_LIMIT);
  } catch { return []; }
}
export function saveSaved(list: DeskItem[], storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): boolean {
  try { storage?.setItem(SAVED_KEY, JSON.stringify({ version: 1, items: list.slice(0, SAVED_LIMIT) })); return true; } catch { return false; }
}
export const isSaved = (list: DeskItem[], id: string): boolean => list.some((i) => i.id === id);
export function toggleSaved(list: DeskItem[], item: DeskItem): DeskItem[] {
  return isSaved(list, item.id) ? list.filter((i) => i.id !== item.id) : [item, ...list].slice(0, SAVED_LIMIT);
}
