/* Orchestrates one sync round against any backend (real Firestore or an in-memory fake in tests). */
import type { FavoriteMedia } from '../utils/mediaFavorites';
import type { HistoryEntry } from '../utils/historyStore';
import { mergeFavorites, mergeHistory, type RemoteFav, type RemoteHist, type Tombs } from './syncMerge';

export interface CloudBackend {
  listFavorites(): Promise<RemoteFav[]>;
  putFavorites(docs: RemoteFav[]): Promise<void>;
  listHistory(): Promise<RemoteHist[]>;
  putHistory(docs: RemoteHist[]): Promise<void>;
  deleteHistory(ids: string[]): Promise<void>;
  getHistoryClearedAt(): Promise<number>;
  setHistoryClearedAt(ts: number): Promise<void>;
}
export interface SyncInput { favorites: FavoriteMedia[]; favTombs: Tombs; history: HistoryEntry[]; histTombs: Tombs; historyClearedAt: number; syncHistory: boolean }
export interface SyncSnapshot { remoteFavs: RemoteFav[]; remoteHist: RemoteHist[] | null; remoteClearedAt: number }
export interface SyncResult extends SyncInput { stats: { favPushed: number; histPushed: number; histDeleted: number; favOverLimit: boolean }; snapshot: SyncSnapshot }

/** Pull → merge → push only what differs. Never deletes remote favorites (removals are tombstones); history docs are deleted only by Clear history. */
export async function syncOnce(backend: CloudBackend, input: SyncInput, now: number = Date.now()): Promise<SyncResult> {
  const remoteFavs = await backend.listFavorites();
  const fav = mergeFavorites(input.favorites, input.favTombs, remoteFavs, now);
  if (fav.push.length) await backend.putFavorites(fav.push);
  let result: SyncResult = { ...input, favorites: fav.list, favTombs: fav.tombs, stats: { favPushed: fav.push.length, histPushed: 0, histDeleted: 0, favOverLimit: fav.overLimit }, snapshot: { remoteFavs, remoteHist: null, remoteClearedAt: 0 } };
  if (!input.syncHistory) return result;
  const [remoteHist, remoteClearedAt] = await Promise.all([backend.listHistory(), backend.getHistoryClearedAt()]);
  const h = mergeHistory(input.history, input.histTombs, input.historyClearedAt, remoteHist, remoteClearedAt, now);
  if (h.setCleared) await backend.setHistoryClearedAt(h.clearedAt);
  if (h.deleteIds.length) await backend.deleteHistory(h.deleteIds);
  if (h.push.length) await backend.putHistory(h.push);
  result = { ...result, history: h.entries, histTombs: h.tombs, historyClearedAt: h.clearedAt, stats: { ...result.stats, histPushed: h.push.length, histDeleted: h.deleteIds.length }, snapshot: { remoteFavs, remoteHist, remoteClearedAt } };
  return result;
}
