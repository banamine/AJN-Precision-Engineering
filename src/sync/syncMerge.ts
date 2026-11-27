/* Pure merge rules for cloud sync (no Firebase, no DOM). One rule everywhere: per stable item id, the newest `updatedAt` wins;
 * a removal is a tombstone with its own timestamp, so it can beat an older add and lose to a newer re-add.
 * Device clocks drift, so timestamps from the future are clamped (CLOCK_SKEW_MS) — a device with a wrong clock can't win forever. */
import type { FavoriteMedia } from '../utils/mediaFavorites';
import { MEDIA_FAVORITES_LIMIT } from '../utils/mediaFavorites';
import type { HistoryEntry } from '../utils/historyStore';
import { HISTORY_LIMIT } from '../utils/historyStore';

import type { WatchLaterItem } from '../utils/watchLater';
import { WATCH_LATER_LIMIT } from '../utils/watchLater';

export const CLOCK_SKEW_MS = 5 * 60_000;
export type Tombs = Record<string, number>;
export const clampTs = (ts: number, now: number): number => (Number.isFinite(ts) ? Math.min(ts, now + CLOCK_SKEW_MS) : 0);

/** Firestore doc ids can't contain "/" and are capped, but item ids are URLs. Deterministic 2×53-bit hash (cyrb53); the real id is stored in the doc. */
function cyrb53(str: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}
export const docIdFor = (id: string): string => `i${cyrb53(id, 0)}${cyrb53(id, 7)}${id.length.toString(16)}`;

export type RemoteFav = FavoriteMedia & { updatedAt: number; deleted?: boolean };
export type RemoteHist = HistoryEntry & { updatedAt: number; deleted?: boolean };

/** Cloud docs are untrusted input: ignore anything that isn't a well-formed item or tombstone instead of showing junk. */
function validRemote(r: any): boolean {
  if (!r || typeof r.id !== 'string' || !r.id || !Number.isFinite(r.updatedAt ?? r.playedAt ?? r.savedAt)) return false;
  return r.deleted === true || (typeof r.src === 'string' && typeof r.title === 'string');
}
interface Cand<T> { ts: number; deleted: boolean; item?: T; source: 'local' | 'remote' }
function pick<T>(a: Cand<T> | undefined, b: Cand<T> | undefined): Cand<T> | undefined {
  if (!a || !b) return a ?? b;
  if (a.ts !== b.ts) return a.ts > b.ts ? a : b;
  if (a.deleted !== b.deleted) return a.deleted ? a : b; // tie: the removal wins (safer than resurrecting)
  return b.source === 'remote' ? b : a; // identical state: prefer remote so we don't re-push it
}

export interface FavMergeResult { list: FavoriteMedia[]; tombs: Tombs; push: RemoteFav[]; overLimit: boolean }
export function mergeFavorites(local: FavoriteMedia[], tombs: Tombs, remote: RemoteFav[], now: number): FavMergeResult {
  const best = new Map<string, Cand<FavoriteMedia>>();
  const add = (id: string, c: Cand<FavoriteMedia>) => best.set(id, pick(best.get(id), c)!);
  for (const f of local) add(f.id, { ts: clampTs(f.savedAt, now), deleted: false, item: f, source: 'local' });
  for (const [id, ts] of Object.entries(tombs)) add(id, { ts: clampTs(ts, now), deleted: true, source: 'local' });
  const remoteById = new Map<string, RemoteFav>();
  for (const r of remote) { if (!validRemote(r)) continue; remoteById.set(r.id, r); add(r.id, { ts: clampTs(r.updatedAt, now), deleted: !!r.deleted, item: r, source: 'remote' }); }
  const list: FavoriteMedia[] = []; const outTombs: Tombs = {}; const push: RemoteFav[] = [];
  for (const [id, c] of best) {
    if (c.deleted) outTombs[id] = c.ts; else if (c.item) list.push({ ...c.item, savedAt: c.ts });
    if (c.source === 'local') {
      const r = remoteById.get(id);
      if (!r || clampTs(r.updatedAt, now) !== c.ts || !!r.deleted !== c.deleted) {
        push.push(c.deleted ? ({ id, updatedAt: c.ts, deleted: true } as RemoteFav) : { ...(c.item as FavoriteMedia), savedAt: c.ts, updatedAt: c.ts });
      }
    }
  }
  list.sort((a, b) => b.savedAt - a.savedAt);
  return { list: list.slice(0, MEDIA_FAVORITES_LIMIT), tombs: outTombs, push, overLimit: list.length > MEDIA_FAVORITES_LIMIT };
}

export interface HistMergeResult { entries: HistoryEntry[]; tombs: Tombs; clearedAt: number; push: RemoteHist[]; deleteIds: string[]; setCleared: boolean }
const hTs = (e: { updatedAt?: number; playedAt: number }, now: number) => clampTs(e.updatedAt ?? e.playedAt, now);

/** History: newest-updated version of each item wins (so the freshest RESUME POSITION wins), plays/playedAt take the max.
 *  "Clear history" is a watermark: anything whose last activity is at/before it is dropped everywhere and can't come back from another device. */
export function mergeHistory(local: HistoryEntry[], tombs: Tombs, clearedAt: number, remote: RemoteHist[], remoteClearedAt: number, now: number): HistMergeResult {
  const cleared = Math.max(clampTs(clearedAt, now), clampTs(remoteClearedAt, now));
  const best = new Map<string, Cand<HistoryEntry>>();
  const add = (id: string, c: Cand<HistoryEntry>) => best.set(id, pick(best.get(id), c)!);
  const maxPlays = new Map<string, number>(); const maxPlayedAt = new Map<string, number>();
  const note = (e: HistoryEntry) => { maxPlays.set(e.id, Math.max(maxPlays.get(e.id) ?? 0, e.plays || 1)); maxPlayedAt.set(e.id, Math.max(maxPlayedAt.get(e.id) ?? 0, e.playedAt || 0)); };
  for (const e of local) { note(e); add(e.id, { ts: hTs(e, now), deleted: false, item: e, source: 'local' }); }
  for (const [id, ts] of Object.entries(tombs)) add(id, { ts: clampTs(ts, now), deleted: true, source: 'local' });
  const remoteById = new Map<string, RemoteHist>();
  for (const r of remote) { if (!validRemote(r)) continue; remoteById.set(r.id, r); if (!r.deleted) note(r); add(r.id, { ts: hTs(r, now), deleted: !!r.deleted, item: r, source: 'remote' }); }
  const entries: HistoryEntry[] = []; const outTombs: Tombs = {}; const push: RemoteHist[] = []; const deleteIds: string[] = [];
  for (const [id, c] of best) {
    const r = remoteById.get(id);
    if (c.ts <= cleared) { if (r) deleteIds.push(id); continue; } // wiped by Clear history: drop here and physically remove from the cloud
    if (c.deleted) outTombs[id] = c.ts;
    else if (c.item) {
      const { deleted, ...rest } = c.item as RemoteHist; void deleted;
      entries.push({ ...rest, plays: maxPlays.get(id) ?? rest.plays, playedAt: maxPlayedAt.get(id) ?? rest.playedAt, updatedAt: c.ts });
    }
    if (c.source === 'local' && (!r || hTs(r, now) !== c.ts || !!r.deleted !== c.deleted)) {
      push.push(c.deleted ? ({ id, updatedAt: c.ts, deleted: true } as RemoteHist) : ({ ...(entries[entries.length - 1] as HistoryEntry), updatedAt: c.ts } as RemoteHist));
    }
  }
  entries.sort((a, b) => b.playedAt - a.playedAt);
  return { entries: entries.slice(0, HISTORY_LIMIT), tombs: outTombs, clearedAt: cleared, push, deleteIds, setCleared: cleared > clampTs(remoteClearedAt, now) };
}

export type RemoteWL = WatchLaterItem & { updatedAt: number; deleted?: boolean };
const wlTs = (w: { updatedAt?: number; savedAt: number }, now: number) => clampTs(w.updatedAt ?? w.savedAt, now);
export interface WLMergeResult { list: WatchLaterItem[]; tombs: Tombs; push: RemoteWL[]; overLimit: boolean }
/** Watch Later: same rule as favorites (newest change per item wins; a removal is a tombstone), but the LIST ORDER is the user's:
 *  items already on this device keep their place, items that arrive from another device go on top (newest first). Reordering is not synced. */
export function mergeWatchLater(local: WatchLaterItem[], tombs: Tombs, remote: RemoteWL[], now: number): WLMergeResult {
  const best = new Map<string, Cand<WatchLaterItem>>();
  const add = (id: string, c: Cand<WatchLaterItem>) => best.set(id, pick(best.get(id), c)!);
  for (const w of local) add(w.id, { ts: wlTs(w, now), deleted: false, item: w, source: 'local' });
  for (const [id, ts] of Object.entries(tombs)) add(id, { ts: clampTs(ts, now), deleted: true, source: 'local' });
  const remoteById = new Map<string, RemoteWL>();
  for (const r of remote) {
    if (!validRemote(r)) continue;
    const item = r.deleted ? r : { ...r, progressSeconds: Number.isFinite(r.progressSeconds) && r.progressSeconds >= 0 ? r.progressSeconds : 0, reason: r.reason === 'auto-half' ? 'auto-half' : 'manual', savedAt: Number.isFinite(r.savedAt) ? r.savedAt : (r.updatedAt ?? 0) } as RemoteWL;
    remoteById.set(r.id, item); add(r.id, { ts: wlTs(item, now), deleted: !!r.deleted, item, source: 'remote' });
  }
  const outTombs: Tombs = {}; const push: RemoteWL[] = []; const won = new Map<string, WatchLaterItem>();
  for (const [id, c] of best) {
    if (c.deleted) outTombs[id] = c.ts; else if (c.item) { const { deleted, ...rest } = c.item as RemoteWL; void deleted; won.set(id, { ...rest, updatedAt: c.ts }); }
    if (c.source === 'local') {
      const r = remoteById.get(id);
      if (!r || wlTs(r, now) !== c.ts || !!r.deleted !== c.deleted) push.push(c.deleted ? ({ id, updatedAt: c.ts, deleted: true } as unknown as RemoteWL) : ({ ...(won.get(id) as WatchLaterItem), updatedAt: c.ts } as RemoteWL));
    }
  }
  const localIds = new Set(local.map((w) => w.id));
  const fresh = [...won.values()].filter((w) => !localIds.has(w.id)).sort((a, b) => b.savedAt - a.savedAt);
  const kept = local.map((w) => won.get(w.id)).filter((w): w is WatchLaterItem => Boolean(w));
  const all = [...fresh, ...kept];
  return { list: all.slice(0, WATCH_LATER_LIMIT), tombs: outTombs, push, overLimit: all.length > WATCH_LATER_LIMIT };
}
