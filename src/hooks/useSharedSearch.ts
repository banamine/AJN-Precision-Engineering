/* One search text shared by the Library and TV News search bars (Entry 042, pillar 1). The value lives in sessionStorage,
 * so typing in one view and switching tabs pre-fills the other. Only one of the two views is mounted at a time, so
 * reading on mount and writing on change is enough. (URL hash sync is deliberately not done: the app router treats the
 * whole hash as the destination name, so "#library?q=x" would break routing.) */
import { useCallback, useState } from 'react';

export const SHARED_SEARCH_KEY = 'ajn.search.query';
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const defaultStore = (): Store | undefined => { try { return globalThis.sessionStorage; } catch { return undefined; } };

export function readSharedQuery(storage: Pick<Storage, 'getItem'> | undefined = defaultStore()): string {
  try { return storage?.getItem(SHARED_SEARCH_KEY) ?? ''; } catch { return ''; }
}
export function writeSharedQuery(q: string, storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = defaultStore()): void {
  try { if (q) storage?.setItem(SHARED_SEARCH_KEY, q); else storage?.removeItem(SHARED_SEARCH_KEY); } catch { /* private mode: stays per-view */ }
}

export function useSharedSearch(): [string, (q: string) => void] {
  const [query, setQ] = useState<string>(() => readSharedQuery());
  const set = useCallback((q: string) => { setQ(q); writeSharedQuery(q); }, []);
  return [query, set];
}
