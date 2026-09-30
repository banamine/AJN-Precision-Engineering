/* Pluto TV program listings for Live TV channels that stream from Pluto
 * (jmp2.uk/plu-<id>.m3u8). Pluto's public channel API returns each channel's
 * timeline for a time window as JSON. One 24 h request is ~19.7 MB for ~440 channels (measured), over the
 * 16 MB read cap, so the window is fetched as equal slices (SLICES x 6 h, ~10 MB each) and merged.
 * Refreshed every 2 h; a failed refresh keeps the last good listings.
 * No Node APIs at import time. */
import { safeFetch, readTextCapped, SafeFetchError } from '../safeFetch';

export interface EpgSlot { start: string; stop: string; title: string; description?: string }
export const PLUTO_EPG_REFRESH_MS = 2 * 3600_000;
const WINDOW_BEFORE_MS = 2 * 3600_000, WINDOW_AFTER_MS = 22 * 3600_000;
const MAX_BYTES = 16 * 1024 * 1024;
/** The listing window is cut into SLICES equal time windows; each response stays well under MAX_BYTES.
 *  A slice that still comes back too large is halved (up to MAX_SPLIT_DEPTH times) instead of being dropped. */
export const SLICES = 4;
const MAX_SPLIT_DEPTH = 2, MIN_SLICE_MS = 30 * 60_000;

/** Pluto channel id from a stream URL, or null. */
export function plutoIdOf(url: string): string | null {
  const m = /(?:jmp2\.uk\/plu-|pluto\.tv\/.*?channel\/)([0-9a-f]{24})/i.exec(url);
  return m ? m[1].toLowerCase() : null;
}

const junk = (s: unknown) => !s || /^no info/i.test(String(s));
export function parsePlutoChannels(data: unknown): Map<string, EpgSlot[]> {
  const out = new Map<string, EpgSlot[]>();
  if (!Array.isArray(data)) return out;
  for (const ch of data as any[]) {
    if (!ch?._id || !Array.isArray(ch.timelines)) continue;
    const slots: EpgSlot[] = [];
    for (const t of ch.timelines) {
      if (!t?.start || !t?.stop || !(Date.parse(t.stop) > Date.parse(t.start))) continue;
      const ep = t.episode ?? {};
      const title = String((!junk(t.title) && t.title) || (!junk(ep.name) && ep.name) || ch.name || 'Pluto TV');
      const epName = !junk(ep.name) && ep.name !== title ? String(ep.name) : '';
      const desc = !junk(ep.description) ? String(ep.description) : '';
      slots.push({ start: new Date(t.start).toISOString(), stop: new Date(t.stop).toISOString(), title, description: [epName, desc].filter(Boolean).join(' — ').slice(0, 300) || undefined });
    }
    if (slots.length) out.set(String(ch._id).toLowerCase(), slots.sort((a, b) => a.start.localeCompare(b.start)));
  }
  return out;
}

let cache: { at: number; byId: Map<string, EpgSlot[]> } | null = null;
let refreshing: Promise<void> | null = null;
let fetchImpl: typeof fetch | undefined;
export const plutoEpgStats = { lastOk: null as string | null, lastError: null as string | null, channels: 0, slices: 0, failedSlices: 0 };
export function setPlutoEpgFetchForTests(f?: typeof fetch) { fetchImpl = f; cache = null; refreshing = null; plutoEpgStats.lastOk = null; plutoEpgStats.lastError = null; plutoEpgStats.channels = 0; plutoEpgStats.slices = 0; plutoEpgStats.failedSlices = 0; }

/** Equal, contiguous [start, stop) windows covering [fromMs, toMs). */
export function plutoWindows(fromMs: number, toMs: number, n = SLICES): Array<[number, number]> {
  const step = Math.ceil((toMs - fromMs) / n), out: Array<[number, number]> = [];
  for (let a = fromMs; a < toMs; a += step) out.push([a, Math.min(a + step, toMs)]);
  return out;
}

/** Merge slices: same channel, same start/stop = one slot (a program crossing a slice boundary appears twice). */
export function mergePlutoSlices(parts: Array<Map<string, EpgSlot[]>>): Map<string, EpgSlot[]> {
  const out = new Map<string, EpgSlot[]>();
  for (const part of parts) for (const [id, slots] of part) {
    const cur = out.get(id) ?? [];
    const seen = new Set(cur.map((x) => `${x.start}|${x.stop}`));
    for (const sl of slots) if (!seen.has(`${sl.start}|${sl.stop}`)) { cur.push(sl); seen.add(`${sl.start}|${sl.stop}`); }
    out.set(id, cur.sort((a, b) => a.start.localeCompare(b.start)));
  }
  return out;
}

async function fetchWindow(fromMs: number, toMs: number, depth = 0): Promise<Map<string, EpgSlot[]>> {
  const url = `https://api.pluto.tv/v2/channels?start=${encodeURIComponent(new Date(fromMs).toISOString())}&stop=${encodeURIComponent(new Date(toMs).toISOString())}`;
  try {
    const { res } = await safeFetch(url, { allow: (h) => h === 'api.pluto.tv', timeoutMs: 30_000, fetchImpl, headers: { 'User-Agent': 'Mozilla/5.0 AJN-Precision-Engineering/PlutoEPG' } });
    if (!res.ok) { await res.body?.cancel().catch(() => {}); throw new Error(`HTTP ${res.status}`); }
    return parsePlutoChannels(JSON.parse(await readTextCapped(res, MAX_BYTES)));
  } catch (e) {
    if (e instanceof SafeFetchError && e.reason === 'too_large' && depth < MAX_SPLIT_DEPTH && toMs - fromMs > MIN_SLICE_MS) {
      const mid = fromMs + Math.floor((toMs - fromMs) / 2);
      return mergePlutoSlices([await fetchWindow(fromMs, mid, depth + 1), await fetchWindow(mid, toMs, depth + 1)]);
    }
    throw e;
  }
}

export async function refreshPlutoEpg(now = Date.now()): Promise<void> {
  const windows = plutoWindows(now - WINDOW_BEFORE_MS, now + WINDOW_AFTER_MS);
  const parts: Array<Map<string, EpgSlot[]>> = [], errors: string[] = [];
  for (const [a, b] of windows) { // one at a time: each body is ~10 MB of JSON to hold and parse
    try { parts.push(await fetchWindow(a, b)); } catch (e: any) { errors.push(String(e?.message ?? e)); }
  }
  plutoEpgStats.slices = windows.length; plutoEpgStats.failedSlices = errors.length;
  const byId = mergePlutoSlices(parts);
  if (!byId.size) { // nothing usable: keep the last good listings and say why
    plutoEpgStats.lastError = errors[0] ?? 'no channel timelines in reply';
    return;
  }
  cache = { at: now, byId };
  plutoEpgStats.lastOk = new Date(now).toISOString(); plutoEpgStats.channels = byId.size;
  // A partial refresh is used but never silent: lastError/failedSlices say which part is missing.
  plutoEpgStats.lastError = errors.length ? `partial: ${errors.length} of ${windows.length} windows failed (${errors[0]})` : null;
}

/** Current listings (stale-while-revalidate). First call waits for the fetch. */
export async function getPlutoEpg(now = Date.now()): Promise<Map<string, EpgSlot[]>> {
  if (!cache) { await (refreshing ??= refreshPlutoEpg(now).finally(() => { refreshing = null; })); return cache?.byId ?? new Map(); }
  if (now - cache.at > PLUTO_EPG_REFRESH_MS && !refreshing) refreshing = refreshPlutoEpg(now).finally(() => { refreshing = null; });
  return cache.byId;
}
