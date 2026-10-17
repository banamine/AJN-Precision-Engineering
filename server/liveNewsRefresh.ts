// Cable TV "Live News": automatic re-read of https://livenow.news/index.m3u plus stream checks.
// Every LIVE_NEWS_REFRESH_MS (6 h; first run 30 s after the first Cable TV request):
//   1. re-read the playlist (last good list kept if the read fails);
//   2. curated channels keep their ids and names, their stream URL follows the playlist (https .m3u8 only);
//   3. channels new to the playlist are added only if they pass the same browser check as curated ones
//      (playlist, first variant and first segment all answer with CORS headers, otherwise a browser cannot play them);
//   4. every channel is checked; a channel is hidden after TWO failed checks in a row (a recheck follows 3 min after
//      the first miss) and returns on the next success. If most checks fail at once the problem is our network
//      and nothing is hidden. Names in `blocked` (Press TV) are never added.
// State lives in memory; the curated JSON is the fallback after a restart. No Node APIs at import time.
import { safeFetch, readTextCapped, anyPublicHost, SafeFetchError, PLAYLIST_MAX_BYTES, SOURCE_LIST_MAX_BYTES } from './safeFetch';
import { parseM3uEntries } from './sources/classicM3u';
import { validateLiveNews, LIVE_NEWS_ID_PREFIX, type LiveNewsRecord } from './liveNewsChannels';
import liveNewsJson from './data/liveNewsChannels.json';

export const LIVE_NEWS_REFRESH_MS = 6 * 3600_000;
export const LIVE_NEWS_OFFLINE_AFTER_FAILS = 2;
const APP_ORIGIN = 'https://ajn-precision-engineering.ai.studio';
const MAX_AUTO_ADDED = 40;
const UA = 'Mozilla/5.0 AJN-Precision-Engineering/LiveNews';

interface Json { source?: string; channels?: unknown[]; blocked?: Array<{ tvgId: string }> }
const seedJson = liveNewsJson as Json;
export const LIVE_NEWS_SOURCE = seedJson.source ?? 'https://livenow.news/index.m3u';
const blockedTvg = new Set((seedJson.blocked ?? []).map((b) => b.tvgId.toLowerCase()).concat('presstv'));

type Rec = LiveNewsRecord & { auto?: boolean };
let records: Rec[] = validateLiveNews(seedJson.channels ?? []).valid;
const fails = new Map<string, { fails: number; reason?: string; lastOk?: string }>();
let fetchImpl: typeof fetch | undefined;

export const liveNewsStatus = {
  lastRead: null as string | null, lastReadOk: null as boolean | null, lastReadError: null as string | null,
  lastCheck: null as string | null, channels: 0, hidden: 0, urlsUpdated: [] as string[], added: [] as string[],
  notAdded: [] as Array<{ name: string; reason: string }>, checkSkipped: false, running: false,
};

export function setLiveNewsFetchForTests(f?: typeof fetch) {
  fetchImpl = f; fails.clear();
  records = validateLiveNews(seedJson.channels ?? []).valid;
  Object.assign(liveNewsStatus, { lastRead: null, lastReadOk: null, lastReadError: null, lastCheck: null, channels: 0, hidden: 0, urlsUpdated: [], added: [], notAdded: [], checkSkipped: false, running: false });
}

const isHls = (u: string) => /^https:\/\/[^\s]+\.m3u8(\?|$)/i.test(u);
const hiddenUrl = (u: string) => (fails.get(u)?.fails ?? 0) >= LIVE_NEWS_OFFLINE_AFTER_FAILS;

/** The channels Cable TV should show right now (offline ones left out). */
export function currentLiveNews(): LiveNewsRecord[] { return records.filter((r) => !hiddenUrl(r.url)); }
export function liveNewsSummary() {
  liveNewsStatus.channels = records.length; liveNewsStatus.hidden = records.filter((r) => hiddenUrl(r.url)).length;
  return { ...liveNewsStatus, hiddenChannels: records.filter((r) => hiddenUrl(r.url)).map((r) => ({ name: r.name, reason: fails.get(r.url)?.reason })) };
}

const acao = (res: Response) => { const v = res.headers.get('access-control-allow-origin'); return v === '*' || v === APP_ORIGIN; };

/** One browser-grade check: playlist -> first variant -> first segment must load AND carry CORS headers. */
// A missing CORS header on THIS server-side probe is only a warning, never a failure: some CDNs (seen: CloudFront in front of
// Fox Soul) send the header to browsers but not to every server-side client, so a hard failure would hide channels that play.
export async function checkLiveNewsStream(url: string): Promise<{ ok: boolean; reason?: string; corsWarning?: string }> {
  let corsWarning: string | undefined;
  const opts = { allow: anyPublicHost, timeoutMs: 8_000, fetchImpl, headers: { 'User-Agent': UA, Origin: APP_ORIGIN } };
  try {
    const m = await safeFetch(url, opts);
    if (!m.res.ok) { await m.res.body?.cancel().catch(() => {}); return { ok: false, reason: `playlist HTTP ${m.res.status}` }; }
    const mAcao = acao(m.res);
    const mText = await readTextCapped(m.res, PLAYLIST_MAX_BYTES);
    if (!mText.trimStart().startsWith('#EXTM3U')) return { ok: false, reason: 'not an HLS playlist' };
    if (!mAcao) corsWarning = 'playlist sends no CORS header to this probe';
    const first = (t: string, afterTag: string) => { const l = t.split(/\r?\n/); const i = afterTag ? l.findIndex((x) => x.startsWith(afterTag)) : -1; return l.slice(i + 1).map((x) => x.trim()).find((x) => x && !x.startsWith('#')); };
    let media = mText, mediaUrl = m.finalUrl;
    if (mText.includes('#EXT-X-STREAM-INF')) {
      const v = first(mText, '#EXT-X-STREAM-INF');
      if (!v) return { ok: false, reason: 'master playlist has no variants' };
      const vr = await safeFetch(new URL(v, m.finalUrl), opts);
      if (!vr.res.ok) { await vr.res.body?.cancel().catch(() => {}); return { ok: false, reason: `variant HTTP ${vr.res.status}` }; }
      const vAcao = acao(vr.res);
      media = await readTextCapped(vr.res, PLAYLIST_MAX_BYTES); mediaUrl = vr.finalUrl;
      if (!vAcao) corsWarning ??= 'variant playlist sends no CORS header to this probe';
    }
    if (!media.includes('#EXTINF')) return { ok: false, reason: 'no media segments' };
    const seg = first(media, '#EXTINF');
    if (!seg) return { ok: false, reason: 'no media segments' };
    const sr = await safeFetch(new URL(seg, mediaUrl), { ...opts, headers: { ...opts.headers, Range: 'bytes=0-0' } });
    await sr.res.body?.cancel().catch(() => {});
    if (!sr.res.ok) return { ok: false, reason: `segment HTTP ${sr.res.status}` };
    if (!acao(sr.res)) corsWarning ??= 'segments send no CORS header to this probe';
    return corsWarning ? { ok: true, corsWarning } : { ok: true };
  } catch (e: any) {
    if (e instanceof SafeFetchError) return { ok: false, reason: e.reason === 'timeout' ? 'timeout' : e.message.slice(0, 80) };
    return { ok: false, reason: String(e?.message ?? e).slice(0, 80) };
  }
}

/** Step 1-3: re-read the playlist. Keeps the previous list on any failure. */
export async function refreshLiveNewsList(): Promise<void> {
  liveNewsStatus.lastRead = new Date().toISOString();
  let entries: ReturnType<typeof parseM3uEntries>;
  try {
    const { res } = await safeFetch(LIVE_NEWS_SOURCE, { allow: (h) => h === 'livenow.news', timeoutMs: 15_000, fetchImpl, headers: { 'User-Agent': UA } });
    if (!res.ok) { await res.body?.cancel().catch(() => {}); throw new Error(`HTTP ${res.status}`); }
    const text = await readTextCapped(res, SOURCE_LIST_MAX_BYTES);
    if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('not an M3U playlist');
    entries = parseM3uEntries(text);
    if (!entries.length) throw new Error('playlist has no channels');
  } catch (e: any) {
    liveNewsStatus.lastReadOk = false; liveNewsStatus.lastReadError = String(e?.message ?? e).slice(0, 120);
    return; // last good list stays
  }
  liveNewsStatus.lastReadOk = true; liveNewsStatus.lastReadError = null;
  const byTvg = new Map(entries.filter((e) => e.tvgId).map((e) => [e.tvgId!.toLowerCase(), e]));
  const updated: string[] = [];
  records = records.map((r) => {
    const e = r.tvgId ? byTvg.get(r.tvgId.toLowerCase()) : undefined;
    if (e && isHls(e.url) && e.url !== r.url && !records.some((o) => o !== r && o.url === e.url)) { updated.push(r.name); fails.delete(e.url); return { ...r, url: e.url }; }
    return r;
  });
  const known = new Set(records.map((r) => r.tvgId?.toLowerCase()).filter(Boolean) as string[]);
  const names = new Set(records.map((r) => r.name.toLowerCase()));
  const urls = new Set(records.map((r) => r.url));
  const added: Rec[] = [], notAdded: Array<{ name: string; reason: string }> = [];
  for (const e of entries) {
    const tvg = e.tvgId?.toLowerCase();
    const name = (e.title || e.tvgName || '').trim();
    if (!tvg || known.has(tvg) || blockedTvg.has(tvg)) continue;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(tvg)) { notAdded.push({ name, reason: 'unusable tvg-id' }); continue; }
    if (!name) { notAdded.push({ name: tvg, reason: 'no name' }); continue; }
    if (!isHls(e.url)) { notAdded.push({ name, reason: 'not a direct https .m3u8 stream' }); continue; }
    if (/live-audio/i.test(e.url)) { notAdded.push({ name, reason: 'audio-only rendition' }); continue; }
    if (names.has(name.toLowerCase()) || urls.has(e.url)) { notAdded.push({ name, reason: 'same name or stream as an existing channel' }); continue; }
    if (added.length >= MAX_AUTO_ADDED) { notAdded.push({ name, reason: 'auto-add limit' }); continue; }
    const chk = await checkLiveNewsStream(e.url);
    if (!chk.ok) { notAdded.push({ name, reason: chk.reason ?? 'check failed' }); continue; }
    if (chk.corsWarning) { notAdded.push({ name, reason: `CORS not confirmed (${chk.corsWarning}); test in a browser, then add it to server/data/liveNewsChannels.json` }); continue; }
    const logo = e.tvgLogo && e.tvgLogo.startsWith('https://') && e.tvgLogo.length <= 290 ? e.tvgLogo : undefined;
    added.push({ id: `${LIVE_NEWS_ID_PREFIX}${tvg}`, tvgId: tvg, name, url: e.url, verifiedAt: new Date().toISOString().slice(0, 10), ...(logo ? { logo } : {}), auto: true });
    names.add(name.toLowerCase()); urls.add(e.url);
  }
  if (added.length) records = validateLiveNews([...records, ...added]).valid as Rec[];
  Object.assign(liveNewsStatus, { urlsUpdated: updated, added: added.map((a) => a.name), notAdded });
}

/** Step 4: check every channel; hide after two misses in a row; skip when most fail at once. */
export async function checkLiveNews(urls?: string[], full = true): Promise<{ checked: number; failed: number; applied: boolean }> {
  if (liveNewsStatus.running) return { checked: 0, failed: 0, applied: false };
  liveNewsStatus.running = true;
  try {
    const list = [...new Set(urls ?? records.map((r) => r.url))];
    const results = new Map<string, { ok: boolean; reason?: string }>();
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(8, list.length) }, async () => { while (i < list.length) { const u = list[i++]; results.set(u, await checkLiveNewsStream(u)); } }));
    const failed = [...results.values()].filter((r) => !r.ok).length;
    const applied = !(full && list.length >= 10 && failed / list.length > 0.8); // most failing = our network, not theirs
    if (applied) for (const [u, r] of results) {
      const e = fails.get(u) ?? { fails: 0 };
      if (r.ok) { e.fails = 0; e.reason = undefined; e.lastOk = new Date().toISOString(); } else { e.fails++; e.reason = r.reason; }
      fails.set(u, e);
    }
    if (full) { liveNewsStatus.checkSkipped = !applied; liveNewsStatus.lastCheck = new Date().toISOString(); }
    return { checked: list.length, failed, applied };
  } finally { liveNewsStatus.running = false; }
}
export const liveNewsPendingRechecks = () => records.map((r) => r.url).filter((u) => { const f = fails.get(u)?.fails ?? 0; return f > 0 && f < LIVE_NEWS_OFFLINE_AFTER_FAILS; });

/** One full cycle: re-read, check, then confirm first-time misses 3 minutes later. */
export async function runLiveNewsCycle(recheckDelayMs = 3 * 60_000): Promise<void> {
  await refreshLiveNewsList();
  await checkLiveNews();
  const again = liveNewsPendingRechecks();
  if (again.length) { const t = setTimeout(() => { void checkLiveNews(again, false).catch(() => {}); }, recheckDelayMs); (t as any)?.unref?.(); }
}

let started = false;
export let liveNewsAuto = typeof process !== 'undefined' && process.env?.NODE_ENV !== 'test' && process.env?.LIVE_HEALTH !== 'off' && typeof window === 'undefined';
export function setLiveNewsAutoForTests(on: boolean) { liveNewsAuto = on; started = false; }
/** Called when Cable TV is served: starts the background loop once (never in tests or the browser). */
export function ensureLiveNewsRefresh() {
  if (started || !liveNewsAuto) return;
  started = true;
  const run = () => { void runLiveNewsCycle().then(() => console.log(`[AJN] live news: ${records.length - liveNewsSummary().hidden}/${records.length} channels up, +${liveNewsStatus.added.length} added, ${liveNewsStatus.urlsUpdated.length} urls updated`)).catch((e) => console.warn('[AJN] live news cycle failed:', e?.message)); };
  const first = setTimeout(run, 30_000); (first as any)?.unref?.();
  const every = setInterval(run, LIVE_NEWS_REFRESH_MS); (every as any)?.unref?.();
}
