/* RT Documentaries — an always-on Cable TV channel built from the Internet Archive
 * TV News collection (identifier RT_<YYYYMMDD>_<HHMMSS>_Documentary, ~31 min each).
 *
 * Rules (see claude/AJN_RT_Documentary_Roulette_Channel_Design):
 *  - The pool is a packaged index of identifiers that Archive's own search returned
 *    (tools/build-rt-documentary-index.py). Nothing is invented or guessed.
 *  - Fair rotation: every year-month bucket airs once per round, in a seeded order;
 *    inside a bucket items cycle through a seeded permutation. No Math.random, so
 *    every instance and every reload computes the same day.
 *  - Fresh lane: every 6th slot goes to items aired in the last 14 days (frozen once
 *    per UTC day) so new broadcasts reach air quickly without reshuffling the rest.
 *  - Playability: items are probed (first clip window) shortly before they air;
 *    a failing item is skipped and reported, never replaced by a stand-in video.
 *  - Times are real: the day is laid out from 00:00 UTC with real runtimes.
 */
import { archiveApiFetch } from './archiveLimiter';
import { clipWindows } from './sources/archiveNews';
import type { Program, ScheduleChannel } from '../src/types';
import { buildArchiveProxyUrl } from '../src/utils/archivePlayback';
import { normalizeAssetIdentity, normalizeProgramIdentity, normalizeSourceIdentity } from '../src/utils/epgIdentity';

export const RT_CHANNEL_ID = 'rt-documentaries';
export const RT_CHANNEL_NAME = 'RT Documentaries';
const ORIGIN_MS = Date.UTC(2026, 0, 1);
const DAY_MS = 86_400_000;
const FRESH_EVERY = 6;
const FRESH_WINDOW_DAYS = 14;
const FRESH_MIN_AGE_MS = 6 * 3_600_000; // Archive publishes the MP4 after processing
const MIN_RUNTIME = 600;
const MAX_RUNTIME = 7_200;

export type RtIndexRow = [stamp: string, runtimeSeconds: number | null, language: string];
export interface RtIndexFile { schema: string; generatedAt: string; count: number; items: RtIndexRow[] }

export interface RtItem {
  id: string;            // RT_YYYYMMDD_HHMMSS_Documentary
  airedMs: number;
  runtime: number;       // seconds, from Archive metadata
  bucket: string;        // YYYY-MM
}

export interface RtPool {
  items: RtItem[];
  bucketKeys: string[];
  byBucket: Map<string, RtItem[]>;
  excluded: { noRuntime: number; badRuntime: number; notEnglish: number; badStamp: number };
  /** Lazily extended: sequence index at which each UTC day (since ORIGIN) starts. */
  dayStarts: number[];
  orderCache: Map<number, string[]>;
  permCache: Map<string, RtItem[]>;
}

/* ---------- deterministic randomness ---------- */
function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededShuffle<T>(values: readonly T[], seedText: string): T[] {
  const out = [...values];
  const rand = mulberry32(hash32(seedText));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ---------- pool ---------- */
const STAMP = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/;
export function rtItemFrom(stamp: string, runtime: number | null | undefined): RtItem | null {
  const m = STAMP.exec(stamp);
  if (!m) return null;
  const airedMs = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  if (!Number.isFinite(airedMs) || !runtime) return null;
  return { id: `RT_${stamp}_Documentary`, airedMs, runtime, bucket: `${m[1]}-${m[2]}` };
}

export function buildRtPool(file: RtIndexFile): RtPool {
  const excluded = { noRuntime: 0, badRuntime: 0, notEnglish: 0, badStamp: 0 };
  const items: RtItem[] = [];
  for (const [stamp, runtime, language] of file.items) {
    if (language && language !== 'eng') { excluded.notEnglish++; continue; }
    if (!runtime) { excluded.noRuntime++; continue; }
    if (runtime < MIN_RUNTIME || runtime > MAX_RUNTIME) { excluded.badRuntime++; continue; }
    const item = rtItemFrom(stamp, runtime);
    if (!item) { excluded.badStamp++; continue; }
    items.push(item);
  }
  items.sort((a, b) => a.id.localeCompare(b.id));
  const byBucket = new Map<string, RtItem[]>();
  for (const item of items) {
    const list = byBucket.get(item.bucket);
    if (list) list.push(item); else byBucket.set(item.bucket, [item]);
  }
  return { items, bucketKeys: [...byBucket.keys()].sort(), byBucket, excluded, dayStarts: [0], orderCache: new Map(), permCache: new Map() };
}

/** Sequence element n: round r = floor(n / B); each round visits every bucket once
 *  (seeded order); the bucket yields the r-th item of its own seeded permutation. */
export function sequenceItem(pool: RtPool, n: number): RtItem {
  const B = pool.bucketKeys.length;
  const round = Math.floor(n / B);
  const pos = n - round * B;
  let order = pool.orderCache.get(round);
  if (!order) {
    order = seededShuffle(pool.bucketKeys, `rt|order|${round}`);
    if (pool.orderCache.size > 64) pool.orderCache.clear();
    pool.orderCache.set(round, order);
  }
  const key = order[pos];
  let perm = pool.permCache.get(key);
  if (!perm) {
    perm = seededShuffle(pool.byBucket.get(key)!, `rt|bucket|${key}`);
    pool.permCache.set(key, perm);
  }
  return perm[round % perm.length];
}

function dayIndex(now: Date): number {
  return Math.max(0, Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - ORIGIN_MS) / DAY_MS));
}

/** Sequence index where UTC day `d` starts. Depends only on the packaged pool. */
export function dayStartIndex(pool: RtPool, d: number): number {
  while (pool.dayStarts.length <= d) {
    let n = pool.dayStarts[pool.dayStarts.length - 1];
    let t = 0;
    while (t < 86_400) { t += sequenceItem(pool, n).runtime; n++; }
    pool.dayStarts.push(n);
  }
  return pool.dayStarts[d];
}

export interface RtSlot { item: RtItem; startMs: number; endMs: number; fresh: boolean; sequence: number }

export function layoutRtDay(pool: RtPool, fresh: readonly RtItem[], now: Date, skip: ReadonlySet<string> = new Set()): RtSlot[] {
  if (pool.items.length === 0) return [];
  const dayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const endMs = dayMs + DAY_MS;
  let n = dayStartIndex(pool, dayIndex(now));
  let t = dayMs;
  const out: RtSlot[] = [];
  const usable = fresh.filter((f) => !skip.has(f.id));
  let guard = 0;
  while (t < endMs && guard++ < 400) {
    const isFreshSlot = usable.length > 0 && n % FRESH_EVERY === FRESH_EVERY - 1;
    const item = isFreshSlot ? usable[Math.floor(n / FRESH_EVERY) % usable.length] : sequenceItem(pool, n);
    const sequence = n++;
    if (skip.has(item.id)) continue;
    const stop = Math.min(t + item.runtime * 1000, endMs);
    out.push({ item, startMs: t, endMs: stop, fresh: isFreshSlot, sequence });
    t = stop;
  }
  return out;
}

/* ---------- Program construction ---------- */
function airedLabel(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function rtProgramFor(slot: RtSlot, dayMs: number, slotIndex: number, guideId: string): Program {
  const { item } = slot;
  const hour = (ms: number) => (ms - dayMs) / 3_600_000;
  const aired = new Date(item.airedMs);
  const windows = clipWindows(item.runtime);
  const segments = windows.map(([start, end], index) => {
    const archivePath = `/download/${item.id}/${item.id}.mp4?exact=1&start=${start}&end=${end}`;
    return { index, start, end, archivePath, mediaUrl: buildArchiveProxyUrl(archivePath) };
  });
  const first = segments[0];
  const programId = normalizeProgramIdentity({ externalId: item.id, channelId: RT_CHANNEL_ID, title: 'Documentary', startTime: aired.toISOString() });
  return {
    id: `${programId}:d${slotIndex}`,
    guideId,
    channelId: RT_CHANNEL_ID,
    title: `${airedLabel(item.airedMs)} · RT Documentary`,
    description: `RT broadcast of its “Documentary” programme block, originally aired ${aired.toISOString().replace('T', ' ').slice(0, 16)} UTC. Internet Archive TV News recording ${item.id}.`,
    startTime: hour(slot.startMs), endTime: hour(slot.endMs), startHour: hour(slot.startMs), endHour: hour(slot.endMs),
    startTimeUtc: new Date(slot.startMs).toISOString(),
    endTimeUtc: new Date(slot.endMs).toISOString(),
    mediaType: 'video',
    mediaUrl: first.mediaUrl,
    archivePath: first.archivePath,
    assetId: normalizeAssetIdentity({ externalId: `${item.id}:${first.start}`, archiveIdentifier: item.id, programId, mediaUrl: first.archivePath }),
    sourceId: normalizeSourceIdentity({ channelId: RT_CHANNEL_ID, url: 'archive:RT', protocol: 'direct_archive' }),
    sourceClass: 'archive_org',
    isArchivedSource: true,
    metadata: {
      externalId: item.id, network: 'RT', show: 'Documentary', lane: 'rt-documentary',
      bucket: item.bucket, freshSlot: slot.fresh, airedUtc: aired.toISOString(),
      durationSeconds: Math.round((slot.endMs - slot.startMs) / 1000), itemDurationSeconds: item.runtime, durationSource: 'metadata',
      segments,
    },
  };
}

/* ---------- playability probe (admission) ---------- */
export type ProbeResult = 'ok' | 'unplayable' | 'unknown';
export async function probeRtItem(id: string, fetchImpl: typeof fetch = archiveApiFetch, signal?: AbortSignal): Promise<ProbeResult> {
  try {
    const url = `https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(id)}.mp4?exact=1&start=0&end=282`;
    const res = await fetchImpl(url, { signal, headers: { Range: 'bytes=0-1023', 'User-Agent': 'AJN-Precision-Engineering/RT-probe' } });
    await res.body?.cancel().catch(() => {});
    if (res.status === 429 || res.status >= 500) return 'unknown';
    const type = String(res.headers.get('content-type') ?? '').toLowerCase();
    if ((res.status === 200 || res.status === 206) && type.startsWith('video/')) return 'ok';
    return 'unplayable';
  } catch {
    return 'unknown';
  }
}

/* ---------- runtime state ---------- */
export interface RtDeps {
  fetchImpl?: typeof fetch;
  loadIndex?: () => Promise<RtIndexFile>;
  now?: () => Date;
  /** Tests set this so no background probes fire. */
  probe?: typeof probeRtItem;
}

let poolPromise: Promise<RtPool> | null = null;
let freshState: { day: string; items: RtItem[]; error?: string; retryAt: number } | null = null;
let freshInFlight: Promise<void> | null = null;
const admission = new Map<string, { result: ProbeResult; at: number }>();
const probing = new Set<string>();
const ADMISSION_TTL_MS = 24 * 3_600_000;

export function resetRtStateForTests() { poolPromise = null; freshState = null; freshInFlight = null; admission.clear(); probing.clear(); }

async function loadPool(deps: RtDeps): Promise<RtPool> {
  poolPromise ??= (deps.loadIndex ?? (async () => {
    const mod: any = await import('../src/data/rtDocumentaryIndex.json');
    return (mod.default ?? mod) as RtIndexFile;
  }))().then(buildRtPool).catch((error) => { poolPromise = null; throw error; });
  return poolPromise;
}

export async function fetchFreshItems(now: Date, fetchImpl: typeof fetch = archiveApiFetch, signal?: AbortSignal): Promise<RtItem[]> {
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const from = day(now.getTime() - FRESH_WINDOW_DAYS * DAY_MS);
  const q = `collection:tvnews AND identifier:RT_*_Documentary AND date:[${from} TO ${day(now.getTime())}]`;
  const url = 'https://archive.org/advancedsearch.php?q=' + encodeURIComponent(q)
    + '&fl[]=identifier&fl[]=runtime&fl[]=language&sort[]=date+desc&rows=100&output=json';
  const res = await fetchImpl(url, { signal, headers: { 'User-Agent': 'AJN-Precision-Engineering/RT-fresh', Accept: 'application/json' } });
  if (!res.ok) { await res.body?.cancel().catch(() => {}); throw new Error(`advancedsearch HTTP ${res.status}`); }
  const body: any = await res.json();
  const out: RtItem[] = [];
  for (const doc of body?.response?.docs ?? []) {
    const m = /^RT_(\d{8}_\d{6})_Documentary$/.exec(String(doc.identifier ?? ''));
    if (!m) continue;
    const language = String(Array.isArray(doc.language) ? doc.language[0] : doc.language ?? '').toLowerCase();
    if (language && language !== 'eng') continue;
    const raw = Array.isArray(doc.runtime) ? doc.runtime[0] : doc.runtime;
    const parts = String(raw ?? '').split(':').map(Number);
    const runtime = parts.length && parts.every(Number.isFinite) ? Math.round(parts.reduce((a, v) => a * 60 + v, 0)) : 0;
    if (runtime < MIN_RUNTIME || runtime > MAX_RUNTIME) continue;
    const item = rtItemFrom(m[1], runtime);
    if (item && item.airedMs <= now.getTime() - FRESH_MIN_AGE_MS) out.push(item);
  }
  return out.sort((a, b) => b.airedMs - a.airedMs);
}

/** Fresh list is frozen per UTC day so the schedule does not reshuffle mid-day. */
async function ensureFresh(now: Date, deps: RtDeps): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  if (freshState?.day === day && (freshState.items.length > 0 || Date.now() < freshState.retryAt)) return;
  if (!freshInFlight) {
    freshInFlight = (async () => {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8_000);
      try {
        const items = await fetchFreshItems(now, deps.fetchImpl ?? archiveApiFetch, ctl.signal);
        freshState = { day, items, retryAt: items.length ? Infinity : Date.now() + 10 * 60_000, error: items.length ? undefined : 'no recent RT documentary broadcasts found' };
      } catch (error: any) {
        freshState = { day, items: freshState?.day === day ? freshState.items : [], retryAt: Date.now() + 10 * 60_000, error: `recent-broadcast search failed: ${error?.message ?? error}` };
      } finally { clearTimeout(timer); }
    })().finally(() => { freshInFlight = null; });
  }
  await freshInFlight;
}

function skipSet(now: number): Set<string> {
  const out = new Set<string>();
  for (const [id, v] of admission) {
    if (now - v.at > ADMISSION_TTL_MS) admission.delete(id);
    else if (v.result === 'unplayable') out.add(id);
  }
  return out;
}

function kickProbes(slots: RtSlot[], now: Date, deps: RtDeps) {
  const probe = deps.probe ?? probeRtItem;
  const horizon = now.getTime() + 3 * 3_600_000;
  const due = slots.filter((s) => s.endMs > now.getTime() && s.startMs < horizon && !admission.has(s.item.id) && !probing.has(s.item.id)).slice(0, 8);
  for (const slot of due) probing.add(slot.item.id);
  if (!due.length) return;
  void (async () => {
    for (const slot of due) {
      const result = await probe(slot.item.id, deps.fetchImpl ?? archiveApiFetch);
      if (result !== 'unknown') admission.set(slot.item.id, { result, at: Date.now() });
      probing.delete(slot.item.id);
    }
  })();
}

export async function getRtDocumentaryChannel(guideId: string, deps: RtDeps = {}): Promise<ScheduleChannel> {
  const now = (deps.now ?? (() => new Date()))();
  const base = { id: RT_CHANNEL_ID, guideId, name: RT_CHANNEL_NAME, mediaType: 'video' as const, group: 'Documentary', logo: 'https://archive.org/services/img/RT' };
  let pool: RtPool;
  try { pool = await loadPool(deps); } catch (error: any) {
    return { ...base, programs: [], sourceStatus: 'upstream_error', sourceError: `RT documentary index could not be loaded: ${error?.message ?? error}` };
  }
  if (pool.items.length === 0) return { ...base, programs: [], sourceStatus: 'upstream_error', sourceError: 'RT documentary index has no playable items' };
  await ensureFresh(now, deps);
  const skip = skipSet(now.getTime());
  const slots = layoutRtDay(pool, freshState?.items ?? [], now, skip);
  kickProbes(slots, now, deps);
  const dayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const programs = slots.map((slot, i) => rtProgramFor(slot, dayMs, i, guideId));
  const rejected = [...skip].map((id) => ({ id, reason: 'unplayable: first clip window did not return video' }));
  const problem = freshState?.error;
  return {
    ...base, programs,
    sourceStatus: problem ? 'partial' : 'ok',
    sourceError: problem,
    rejected: rejected.length ? rejected.slice(0, 100) : undefined,
  };
}

export function rtPoolStats(pool: RtPool) {
  return { items: pool.items.length, buckets: pool.bucketKeys.length, excluded: pool.excluded };
}
export { loadPool as loadRtPoolForTests };
