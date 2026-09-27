/* Pluto TV program listings for Live TV channels that stream from Pluto
 * (jmp2.uk/plu-<id>.m3u8). Pluto's public channel API returns each channel's
 * timeline for a time window as JSON (~5 MB for 12 h, ~440 channels).
 * Refreshed every 2 h; a failed refresh keeps the last good listings.
 * No Node APIs at import time. */
import { safeFetch, readTextCapped } from '../safeFetch';

export interface EpgSlot { start: string; stop: string; title: string; description?: string }
export const PLUTO_EPG_REFRESH_MS = 2 * 3600_000;
const WINDOW_BEFORE_MS = 2 * 3600_000, WINDOW_AFTER_MS = 22 * 3600_000;
const MAX_BYTES = 16 * 1024 * 1024;

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
export const plutoEpgStats = { lastOk: null as string | null, lastError: null as string | null, channels: 0 };
export function setPlutoEpgFetchForTests(f?: typeof fetch) { fetchImpl = f; cache = null; refreshing = null; plutoEpgStats.lastOk = null; plutoEpgStats.lastError = null; plutoEpgStats.channels = 0; }

export async function refreshPlutoEpg(now = Date.now()): Promise<void> {
  const start = new Date(now - WINDOW_BEFORE_MS).toISOString(), stop = new Date(now + WINDOW_AFTER_MS).toISOString();
  try {
    const { res } = await safeFetch(`https://api.pluto.tv/v2/channels?start=${encodeURIComponent(start)}&stop=${encodeURIComponent(stop)}`,
      { allow: (h) => h === 'api.pluto.tv', timeoutMs: 30_000, fetchImpl, headers: { 'User-Agent': 'Mozilla/5.0 AJN-Precision-Engineering/PlutoEPG' } });
    if (!res.ok) { await res.body?.cancel().catch(() => {}); throw new Error(`HTTP ${res.status}`); }
    const byId = parsePlutoChannels(JSON.parse(await readTextCapped(res, MAX_BYTES)));
    if (!byId.size) throw new Error('no channel timelines in reply');
    cache = { at: now, byId };
    plutoEpgStats.lastOk = new Date(now).toISOString(); plutoEpgStats.channels = byId.size; plutoEpgStats.lastError = null;
  } catch (e: any) {
    plutoEpgStats.lastError = String(e?.message ?? e); // last good listings stay in `cache`
  }
}

/** Current listings (stale-while-revalidate). First call waits for the fetch. */
export async function getPlutoEpg(now = Date.now()): Promise<Map<string, EpgSlot[]>> {
  if (!cache) { await (refreshing ??= refreshPlutoEpg(now).finally(() => { refreshing = null; })); return cache?.byId ?? new Map(); }
  if (now - cache.at > PLUTO_EPG_REFRESH_MS && !refreshing) refreshing = refreshPlutoEpg(now).finally(() => { refreshing = null; });
  return cache.byId;
}
