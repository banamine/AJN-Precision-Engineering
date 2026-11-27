/* Orchestrates one sync round against any backend (real Firestore or an in-memory fake in tests). */
import type { FavoriteMedia } from '../utils/mediaFavorites';
import type { HistoryEntry } from '../utils/historyStore';
import type { WatchLaterItem } from '../utils/watchLater';
import { mergeFavorites, mergeHistory, mergeWatchLater, type RemoteFav, type RemoteHist, type RemoteWL, type Tombs } from './syncMerge';

export interface CloudBackend {
  listFavorites(): Promise<RemoteFav[]>;
  putFavorites(docs: RemoteFav[]): Promise<void>;
  listWatchLater(): Promise<RemoteWL[]>;
  putWatchLater(docs: RemoteWL[]): Promise<void>;
  listHistory(): Promise<RemoteHist[]>;
  putHistory(docs: RemoteHist[]): Promise<void>;
  deleteHistory(ids: string[]): Promise<void>;
  getHistoryClearedAt(): Promise<number>;
  setHistoryClearedAt(ts: number): Promise<void>;
}
export interface SyncInput { favorites: FavoriteMedia[]; favTombs: Tombs; /** Watch Later list + removal tombstones (omitted = nothing to sync) */ watchLater?: WatchLaterItem[]; wlTombs?: Tombs; history: HistoryEntry[]; histTombs: Tombs; historyClearedAt: number; syncHistory: boolean }
export interface SyncSnapshot { remoteFavs: RemoteFav[]; remoteWatchLater: RemoteWL[]; remoteHist: RemoteHist[] | null; remoteClearedAt: number }
export interface SyncResult extends SyncInput { stats: { favPushed: number; wlPushed: number; histPushed: number; histDeleted: number; favOverLimit: boolean }; snapshot: SyncSnapshot }

/** Pull → merge → push only what differs. Never deletes remote favorites (removals are tombstones); history docs are deleted only by Clear history. */
export async function syncOnce(backend: CloudBackend, input: SyncInput, now: number = Date.now()): Promise<SyncResult> {
  const remoteFavs = await backend.listFavorites();
  const fav = mergeFavorites(input.favorites, input.favTombs, remoteFavs, now);
  if (fav.push.length) await backend.putFavorites(fav.push);
  const remoteWL = await backend.listWatchLater();
  const wl = mergeWatchLater(input.watchLater ?? [], input.wlTombs ?? {}, remoteWL, now);
  if (wl.push.length) await backend.putWatchLater(wl.push);
  let result: SyncResult = { ...input, favorites: fav.list, favTombs: fav.tombs, watchLater: wl.list, wlTombs: wl.tombs, stats: { favPushed: fav.push.length, wlPushed: wl.push.length, histPushed: 0, histDeleted: 0, favOverLimit: fav.overLimit }, snapshot: { remoteFavs, remoteWatchLater: remoteWL, remoteHist: null, remoteClearedAt: 0 } };
  if (!input.syncHistory) return result;
  const [remoteHist, remoteClearedAt] = await Promise.all([backend.listHistory(), backend.getHistoryClearedAt()]);
  const h = mergeHistory(input.history, input.histTombs, input.historyClearedAt, remoteHist, remoteClearedAt, now);
  if (h.setCleared) await backend.setHistoryClearedAt(h.clearedAt);
  if (h.deleteIds.length) await backend.deleteHistory(h.deleteIds);
  if (h.push.length) await backend.putHistory(h.push);
  result = { ...result, history: h.entries, histTombs: h.tombs, historyClearedAt: h.clearedAt, stats: { ...result.stats, histPushed: h.push.length, histDeleted: h.deleteIds.length }, snapshot: { remoteFavs, remoteWatchLater: remoteWL, remoteHist, remoteClearedAt } };
  return result;
}
