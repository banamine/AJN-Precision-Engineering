/* Live TV health: which channels actually answer. Checked in the background
 * after each channel-list refresh, a few at a time, reading only playlist text
 * (master + first variant; no video). A channel is hidden only after TWO
 * failed checks in a row, so one hiccup never removes it; one success brings
 * it back. If most channels fail in one run the problem is our network, not
 * theirs, and nothing is marked.
 * No Node APIs at import time (the browser bundle evaluates guideRegistry). */
import { safeFetch, readTextCapped, anyPublicHost, PLAYLIST_MAX_BYTES } from './safeFetch';

export type Health = 'ok' | 'offline' | 'unknown';
interface Entry { fails: number; lastCheck: number; lastOk?: number; reason?: string; /** Consecutive timeouts: slow is not dead, so they are counted apart from real failures. */ timeouts?: number }
const state = new Map<string, Entry>();
/** Identifies this server process: several Cloud Run instances each keep their own health memory. */
const INSTANCE_ID = Math.random().toString(36).slice(2, 8);
const STARTED_AT = new Date().toISOString();
export const liveHealthStats = { instance: INSTANCE_ID, startedAt: STARTED_AT, runs: 0, lastRun: null as string | null, running: false, checked: 0, ok: 0, offline: 0, offlineReasons: {} as Record<string, number>, skippedRun: false };

let fetchImpl: typeof fetch | undefined;
export function setLiveHealthFetchForTests(f?: typeof fetch) { fetchImpl = f; state.clear(); Object.assign(liveHealthStats, { runs: 0, lastRun: null, running: false, checked: 0, ok: 0, offline: 0, offlineReasons: {}, skippedRun: false }); }

let checkTimeoutMs = 6_000;
export function setLiveHealthTimeoutForTests(ms: number) { checkTimeoutMs = ms; }
export const OFFLINE_AFTER_FAILS = 2;
/** A check that only times out proves nothing about the channel (our cloud network may be slow): hide it only after this many in a row. */
export const OFFLINE_AFTER_TIMEOUTS = 4;
const isOffline = (e: Entry): boolean => e.fails >= OFFLINE_AFTER_FAILS || (e.timeouts ?? 0) >= OFFLINE_AFTER_TIMEOUTS;
export function healthOf(url: string): Health {
  const e = state.get(url);
  if (!e) return 'unknown';
  return isOffline(e) ? 'offline' : 'ok';
}
export function healthReason(url: string): string | undefined { return state.get(url)?.reason; }

/** One check: the playlist (and, for a master, its first variant) must load and be HLS. */
export async function checkStream(url: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const { res, finalUrl } = await safeFetch(url, { allow: anyPublicHost, timeoutMs: checkTimeoutMs, fetchImpl, headers: { 'User-Agent': 'Mozilla/5.0 AJN-Precision-Engineering/LiveHealth' } });
    if (!res.ok) { await res.body?.cancel().catch(() => {}); return { ok: false, reason: `playlist HTTP ${res.status}` }; }
    // A server that sends Access-Control-Allow-Origin twice ("*, *") answers 200 here, but browsers reject the response, so the channel can never play in the app.
    const acao = res.headers.get('access-control-allow-origin');
    if (acao && acao.includes(',')) { await res.body?.cancel().catch(() => {}); return { ok: false, reason: `duplicate Access-Control-Allow-Origin (${acao.slice(0, 30)}): browsers block it` }; }
    const text = await readTextCapped(res, PLAYLIST_MAX_BYTES);
    if (!text.trimStart().startsWith('#EXTM3U')) return { ok: false, reason: 'not an HLS playlist' };
    if (!text.includes('#EXT-X-STREAM-INF')) return { ok: true };
    const lines = text.split(/\r?\n/);
    const i = lines.findIndex((l) => l.startsWith('#EXT-X-STREAM-INF'));
    const v = lines.slice(i + 1).map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
    if (!v) return { ok: false, reason: 'master playlist has no variants' };
    const vr = await safeFetch(new URL(v, finalUrl), { allow: anyPublicHost, timeoutMs: checkTimeoutMs, fetchImpl });
    await vr.res.body?.cancel().catch(() => {});
    return vr.res.ok ? { ok: true } : { ok: false, reason: `variant HTTP ${vr.res.status}` };
  } catch (e: any) {
    return { ok: false, reason: e?.reason ?? (e?.name === 'TimeoutError' ? 'timeout' : String(e?.message ?? e).slice(0, 80)) };
  }
}

/** Check every URL (bounded concurrency) and update state. Returns counts. */
/** full=true: every channel (prunes URLs no longer listed; skipped if >80% fail).
 *  full=false: a recheck of some URLs (e.g. those that just failed). */
export async function runHealthCheck(urls: string[], concurrency = 24, full = true): Promise<{ checked: number; ok: number; failed: number; applied: boolean }> {
  if (liveHealthStats.running) return { checked: 0, ok: 0, failed: 0, applied: false };
  liveHealthStats.running = true;
  try {
    const unique = [...new Set(urls)];
    const results = new Map<string, { ok: boolean; reason?: string }>();
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, async () => {
      while (i < unique.length) { const u = unique[i++]; results.set(u, await checkStream(u)); }
    }));
    const failed = [...results.values()].filter((r) => !r.ok).length;
    // Most channels failing at once = our network; don't punish the channels.
    const applied = !(full && unique.length >= 10 && failed / unique.length > 0.8);
    const now = Date.now();
    if (applied) for (const [u, r] of results) {
      const e = state.get(u) ?? { fails: 0, lastCheck: 0 };
      e.lastCheck = now;
      if (r.ok) { e.fails = 0; e.timeouts = 0; e.lastOk = now; e.reason = undefined; }
      else if (r.reason === 'timeout') { e.timeouts = (e.timeouts ?? 0) + 1; e.reason = r.reason; }
      else { e.fails++; e.timeouts = 0; e.reason = r.reason; }
      state.set(u, e);
    }
    if (full && applied) for (const u of [...state.keys()]) if (!results.has(u)) state.delete(u); // gone from the lists
    liveHealthStats.runs++; liveHealthStats.lastRun = new Date(now).toISOString(); if (full) liveHealthStats.skippedRun = !applied;
    liveHealthStats.checked = state.size;
    const offlineEntries = [...state.values()].filter(isOffline);
    liveHealthStats.offline = offlineEntries.length;
    liveHealthStats.offlineReasons = {};
    for (const e of offlineEntries) { const k = (e.reason ?? 'unknown').replace(/[0-9]{3,}/g, 'N').slice(0, 60); liveHealthStats.offlineReasons[k] = (liveHealthStats.offlineReasons[k] ?? 0) + 1; }
    liveHealthStats.ok = liveHealthStats.checked - liveHealthStats.offline;
    return { checked: unique.length, ok: unique.length - failed, failed, applied };
  } finally { liveHealthStats.running = false; }
}

/** Cold-start seed: URLs known offline from a previous verified run (committed file). The instance's own
 *  full check overwrites each one (ok clears it), so a seed can only hide a channel until the first pass finishes. */
export function seedKnownOffline(urls: string[]): number {
  let n = 0;
  for (const u of urls) if (!state.has(u)) { state.set(u, { fails: OFFLINE_AFTER_FAILS, lastCheck: 0, reason: 'seeded: offline in last verified run' }); n++; }
  if (n) { liveHealthStats.checked = state.size; liveHealthStats.offline = [...state.values()].filter(isOffline).length; liveHealthStats.ok = liveHealthStats.checked - liveHealthStats.offline; }
  return n;
}

/** Failed URLs that are not yet offline (need a confirming second check). */
export function pendingRechecks(): string[] { return [...state].filter(([, e]) => e.fails > 0 && e.fails < OFFLINE_AFTER_FAILS).map(([u]) => u); }
