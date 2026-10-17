// Police Chase (FOX Clips) upkeep, every 24 h (first run 60 s after the first Cable TV request):
//   1. CHECK each clip with a HEAD on its MP4. Same status/size/ETag/Last-Modified = fine.
//      ETag/size/Last-Modified changed = file replaced: re-read its header (length, H.264/AAC) and update the record.
//      A failed check (404/403/410/5xx/timeout) keeps the clip; a SECOND failed daily check in a row hides it.
//      A later success brings it back. If >80% fail at once it is our network: nothing is hidden.
//   2. DISCOVER: re-read the FOX video pages of the clips we have, collect /video/<id> links, and add a new clip only if
//      its title looks like a chase/pursuit story and it passes the server tests: HEAD 200 video/mp4, ranged GET 206,
//      container length 20 s - 4 h, and H.264 + AAC present. (Playback in a browser was verified by hand for the
//      starting 16 clips only; new clips get these header/codec tests.) At most MAX_NEW_PER_RUN per run, MAX_CLIPS in total.
// State is in memory; foxClips.json is the fallback after a restart. No Node APIs at import time.
import { safeFetch, readTextCapped, SafeFetchError } from './safeFetch';
import { validateFoxClips, foxClipSeed, FOX_MP4_HOST, FOX_PAGE_HOST, type FoxClip } from './foxClips';

export const FOX_CLIPS_REFRESH_MS = 24 * 3600_000;
export const FOX_CLIPS_OFFLINE_AFTER_FAILS = 2;
const MAX_NEW_PER_RUN = 8, MAX_CLIPS = 60, MAX_MOOV = 8 * 1024 * 1024, PAGE_MAX = 3 * 1024 * 1024;
const CHASE_RE = /\b(chase|chases|pursuit|pursuits|pursue|pursues|pursued|police|suspect|carjack\w*|fleeing|flees|standoff|crash)\b/i;
const UA = 'Mozilla/5.0 AJN-Precision-Engineering/FoxClips';

let records: FoxClip[] = validateFoxClips(foxClipSeed()).valid;
const fails = new Map<string, number>(); // clip id -> consecutive failed daily checks
let fetchImpl: typeof fetch | undefined;

export const foxClipsStatus = {
  lastRun: null as string | null, running: false, checked: 0, failedThisRun: 0, skippedRun: false,
  changed: [] as string[], added: [] as string[], notAdded: [] as Array<{ id: string; title?: string; reason: string }>, discoverError: null as string | null,
};
export function setFoxClipsFetchForTests(f?: typeof fetch) {
  fetchImpl = f; fails.clear(); records = validateFoxClips(foxClipSeed()).valid;
  Object.assign(foxClipsStatus, { lastRun: null, running: false, checked: 0, failedThisRun: 0, skippedRun: false, changed: [], added: [], notAdded: [], discoverError: null });
}
export const currentFoxClips = (): FoxClip[] => records.filter((c) => (fails.get(c.id) ?? 0) < FOX_CLIPS_OFFLINE_AFTER_FAILS);
export function foxClipsSummary() {
  const hidden = records.filter((c) => (fails.get(c.id) ?? 0) >= FOX_CLIPS_OFFLINE_AFTER_FAILS);
  return { ...foxClipsStatus, clips: records.length, hidden: hidden.length, hiddenClips: hidden.map((c) => c.title), pendingRecheck: records.filter((c) => (fails.get(c.id) ?? 0) === 1).map((c) => c.id) };
}

const mp4Opts = (extra: Record<string, string> = {}) => ({ allow: (h: string) => h === FOX_MP4_HOST, timeoutMs: 15_000, fetchImpl, headers: { 'User-Agent': UA, ...extra } });
const getRange = async (url: string, a: number, b: number): Promise<Uint8Array | null> => {
  const { res } = await safeFetch(url, { ...mp4Opts({ Range: `bytes=${a}-${b}` }) });
  if (res.status !== 206 && res.status !== 200) { await res.body?.cancel().catch(() => {}); return null; }
  const buf = new Uint8Array(await res.arrayBuffer());
  return buf.length > b - a + 1 ? buf.slice(0, b - a + 1) : buf; // a server that ignores Range sends everything: cap it
};

/** Read the file's own header: length (mvhd) and whether H.264 + AAC are present. Ranged reads only. */
export async function probeMp4(url: string, size: number): Promise<{ seconds: number; avc1: boolean; aac: boolean }> {
  let pos = 0;
  for (let i = 0; i < 12 && pos < size; i++) {
    const h = await getRange(url, pos, pos + 15);
    if (!h || h.length < 8) throw new Error('unreadable box header');
    const dv = new DataView(h.buffer, h.byteOffset, h.byteLength);
    let len = dv.getUint32(0); const type = String.fromCharCode(h[4], h[5], h[6], h[7]);
    if (len === 1 && h.length >= 16) len = Number(dv.getBigUint64(8)); else if (len === 0) len = size - pos;
    if (len < 8) throw new Error('bad box size');
    if (type === 'moov') {
      if (len > MAX_MOOV) throw new Error('moov too large');
      const m = await getRange(url, pos, pos + len - 1);
      if (!m || m.length < len) throw new Error('moov truncated');
      const text = new TextDecoder('latin1').decode(m);
      const k = text.indexOf('mvhd'); if (k < 0) throw new Error('no mvhd');
      const d = new DataView(m.buffer, m.byteOffset, m.byteLength);
      const v = m[k + 4];
      const ts = d.getUint32(k + (v === 0 ? 16 : 24));
      const dur = v === 0 ? d.getUint32(k + 20) : Number(d.getBigUint64(k + 28));
      if (!ts) throw new Error('bad timescale');
      return { seconds: dur / ts, avc1: text.includes('avc1'), aac: text.includes('mp4a') };
    }
    pos += len;
  }
  throw new Error('no moov box');
}

interface Head { status: number; size: number; etag?: string; lastModified?: string; type?: string }
async function headOf(url: string): Promise<Head> {
  const { res } = await safeFetch(url, { ...mp4Opts(), fetchImpl: wrapHead(fetchImpl) });
  await res.body?.cancel().catch(() => {});
  return { status: res.status, size: Number(res.headers.get('content-length')) || 0, etag: res.headers.get('etag') ?? undefined, lastModified: res.headers.get('last-modified') ?? undefined, type: res.headers.get('content-type') ?? undefined };
}
// safeFetch calls fetch(url, {headers,redirect,signal}); make that a HEAD.
const wrapHead = (f?: typeof fetch): typeof fetch => ((i: any, init: any) => (f ?? fetch)(i, { ...init, method: 'HEAD' })) as typeof fetch;

/** Step 1. */
export async function checkFoxClips(): Promise<{ checked: number; failed: number; applied: boolean }> {
  const list = [...records];
  const results = new Map<string, { ok: boolean; changed?: boolean; head?: Head }>();
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(4, list.length) }, async () => {
    while (i < list.length) {
      const c = list[i++];
      try {
        const h = await headOf(c.mp4);
        const ok = h.status === 200 && /video\/mp4/i.test(h.type ?? '') && h.size > 0;
        const changed = ok && ((c.etag && h.etag && c.etag !== h.etag) || (c.size && h.size && c.size !== h.size) || (c.lastModified && h.lastModified && c.lastModified !== h.lastModified));
        results.set(c.id, { ok, changed: !!changed, head: h });
      } catch (e) { if (!(e instanceof SafeFetchError) && !(e as any)?.name) throw e; results.set(c.id, { ok: false }); }
    }
  }));
  const failed = [...results.values()].filter((r) => !r.ok).length;
  const applied = !(list.length >= 10 && failed / list.length > 0.8); // most failing = our network, not FOX
  const changedNames: string[] = [];
  if (applied) for (const c of list) {
    const r = results.get(c.id)!;
    if (!r.ok) { fails.set(c.id, (fails.get(c.id) ?? 0) + 1); continue; }
    fails.delete(c.id);
    if (r.changed && r.head) { // file replaced: re-read its header and refresh the record, or hold it back if the new file is not valid
      try {
        const p = await probeMp4(c.mp4, r.head.size);
        if (!p.avc1 || !p.aac) throw new Error('not H.264/AAC');
        const next = validateFoxClips([{ ...c, seconds: Math.round(p.seconds * 100) / 100, size: r.head.size, etag: r.head.etag, lastModified: r.head.lastModified, verifiedAt: new Date().toISOString().slice(0, 10) }]).valid[0];
        if (!next) throw new Error('new file fails validation');
        records = records.map((x) => (x.id === c.id ? next : x)); changedNames.push(c.title);
      } catch { fails.set(c.id, (fails.get(c.id) ?? 0) + 1); }
    }
  }
  Object.assign(foxClipsStatus, { checked: list.length, failedThisRun: failed, skippedRun: !applied, changed: changedNames });
  return { checked: list.length, failed, applied };
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
async function readPage(id: string): Promise<{ title?: string; uploaded?: string; mp4?: string; thumb?: string; links: string[] } | null> {
  const { res } = await safeFetch(`https://${FOX_PAGE_HOST}/video/${id}`, { allow: (h) => h === FOX_PAGE_HOST, timeoutMs: 20_000, fetchImpl, headers: { 'User-Agent': UA } });
  if (!res.ok) { await res.body?.cancel().catch(() => {}); return null; }
  const html = await readTextCapped(res, PAGE_MAX);
  const title = html.match(/property="og:title" content="([^"]*)"/)?.[1];
  const thumb = html.match(/property="og:image" content="([^"]*)"/)?.[1];
  const uploaded = html.match(/"uploadDate":"([^"]+)"/)?.[1]?.slice(0, 10);
  const mp4 = html.match(new RegExp(`https://${FOX_MP4_HOST.replace(/\./g, '\\.')}[^"\\\\ ]+?\\.mp4`))?.[0];
  const links = [...new Set([...html.matchAll(/\/video\/(\d{5,9})\b/g)].map((m) => m[1]))];
  return { title: title ? decode(title) : undefined, uploaded, mp4, thumb: thumb ? decode(thumb) : undefined, links };
}

/** Step 2. */
export async function discoverFoxClips(): Promise<void> {
  foxClipsStatus.discoverError = null;
  const known = new Set(records.map((c) => c.id));
  const tried = new Set<string>();
  const candidates: string[] = [];
  for (const c of records.slice(0, 6)) { // a handful of pages is enough to see the related-video lists
    try { const p = await readPage(c.id); for (const l of p?.links ?? []) if (!known.has(l) && !tried.has(l)) { tried.add(l); candidates.push(l); } }
    catch (e: any) { foxClipsStatus.discoverError = String(e?.message ?? e).slice(0, 100); }
  }
  const added: FoxClip[] = [], notAdded: Array<{ id: string; title?: string; reason: string }> = [];
  for (const id of candidates) {
    if (added.length >= MAX_NEW_PER_RUN || records.length + added.length >= MAX_CLIPS) { notAdded.push({ id, reason: 'per-run or total limit' }); continue; }
    try {
      const p = await readPage(id);
      if (!p || !p.mp4 || !p.title) { notAdded.push({ id, title: p?.title, reason: 'no MP4 or title on the page' }); continue; }
      if (!CHASE_RE.test(p.title)) { notAdded.push({ id, title: p.title, reason: 'title is not a chase/pursuit story' }); continue; }
      const h = await headOf(p.mp4);
      if (h.status !== 200 || !/video\/mp4/i.test(h.type ?? '') || !h.size) { notAdded.push({ id, title: p.title, reason: `MP4 HEAD ${h.status} ${h.type ?? ''}`.trim() }); continue; }
      const r = await getRange(p.mp4, 0, 1023); if (!r || r.length < 8) { notAdded.push({ id, title: p.title, reason: 'ranged read failed' }); continue; }
      const pr = await probeMp4(p.mp4, h.size);
      if (!pr.avc1 || !pr.aac) { notAdded.push({ id, title: p.title, reason: 'not H.264 + AAC' }); continue; }
      const v = validateFoxClips([{ id, title: p.title, uploaded: p.uploaded, thumb: p.thumb, mp4: p.mp4, seconds: Math.round(pr.seconds * 100) / 100, size: h.size, etag: h.etag, lastModified: h.lastModified, verifiedAt: new Date().toISOString().slice(0, 10) }]);
      if (!v.valid[0]) { notAdded.push({ id, title: p.title, reason: v.rejected[0]?.reason ?? 'invalid' }); continue; }
      added.push(v.valid[0]);
    } catch (e: any) { notAdded.push({ id, reason: String(e?.message ?? e).slice(0, 80) }); }
  }
  if (added.length) records = validateFoxClips([...records, ...added]).valid;
  Object.assign(foxClipsStatus, { added: added.map((a) => a.title), notAdded });
}

export async function runFoxClipsCycle(): Promise<void> {
  if (foxClipsStatus.running) return;
  foxClipsStatus.running = true;
  try {
    foxClipsStatus.lastRun = new Date().toISOString();
    const r = await checkFoxClips();
    if (r.applied) await discoverFoxClips(); // never add while our own network looks broken
  } finally { foxClipsStatus.running = false; }
}

let started = false;
export let foxClipsAuto = typeof process !== 'undefined' && process.env?.NODE_ENV !== 'test' && process.env?.LIVE_HEALTH !== 'off' && typeof window === 'undefined';
export function setFoxClipsAutoForTests(on: boolean) { foxClipsAuto = on; started = false; }
export function ensureFoxClipsRefresh() {
  if (started || !foxClipsAuto) return;
  started = true;
  const run = () => { void runFoxClipsCycle().then(() => console.log(`[AJN] fox clips: ${currentFoxClips().length}/${records.length} up, +${foxClipsStatus.added.length} added, ${foxClipsStatus.changed.length} changed`)).catch((e) => console.warn('[AJN] fox clips cycle failed:', e?.message)); };
  const first = setTimeout(run, 60_000); (first as any)?.unref?.();
  const every = setInterval(run, FOX_CLIPS_REFRESH_MS); (every as any)?.unref?.();
}
