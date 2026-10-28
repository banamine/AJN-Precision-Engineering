/* Rush archive: master index ("what exists") + just-in-time episode resolver
 * ("what files, how long"). The index is a bundled file built offline by
 * scripts/build-rush-index.ts; nothing here searches Archive at runtime.
 * Durations are resolved only for an episode someone asks for, then cached. */
// Namespace imports: the frontend bundle pulls guideRegistry in, and Vite stubs
// node builtins with an empty module that has no named exports.
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { archiveApiFetch } from './archiveLimiter';

export interface RushIndexEntry { id: string; date: string; year: number; role?: 'morning-update' | 'full-show'; }
export interface RushTrack { file: string; durationSeconds: number; size?: number; format?: string; archivePath: string; mediaUrl: string; kind?: string; role?: string; }
interface CacheEntry { resolvedAt: string; files: Array<Omit<RushTrack, 'archivePath' | 'mediaUrl'>>; }

const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Loaded lazily (dynamic import): the frontend bundle pulls guideRegistry in,
// and a static import would ship the whole index to every browser.
let rushIndexCache: RushIndexEntry[] | null = null;
export async function getRushIndex(): Promise<RushIndexEntry[]> {
  if (!rushIndexCache) {
    const mod: any = await import('../src/data/rushIndex.json');
    rushIndexCache = ((mod.default ?? mod) as RushIndexEntry[])
      .filter((e) => e && typeof e.id === 'string' && DATE.test(e.date))
      .map((entry) => ({
        ...entry,
        // Older snapshots omit role; infer it from the stable Archive identifier.
        role: entry.role === 'morning-update' || entry.role === 'full-show'
          ? entry.role
          : /(?:^|[-_/])morning-update(?:[-_/]|$)/i.test(entry.id) ? 'morning-update' : 'full-show',
      }));
  }
  return rushIndexCache;
}

// Durable on a PC/dev box; on Cloud Run it lives only as long as the instance.
// Nothing here may run at import time: the browser bundle also evaluates this
// module (via guideRegistry), where `process` and `fs` do not exist — a top-level
// process.cwd() crashed the whole page on "Initializing AJN System".
let CACHE_FILE = '';
let cache: Record<string, CacheEntry> | null = null;
function loadCache(): Record<string, CacheEntry> {
  if (cache) return cache;
  cache = {};
  try {
    CACHE_FILE = process.env.RUSH_CACHE_FILE || nodePath.join(process.cwd(), '.cache', 'rush-durations.json');
    cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch { /* first run, or not on a server */ }
  return cache!;
}
function saveCache() {
  if (!CACHE_FILE) return;
  try {
    fs.mkdirSync(nodePath.join(CACHE_FILE, '..'), { recursive: true });
    fs.writeFileSync(`${CACHE_FILE}.tmp`, JSON.stringify(cache));
    fs.renameSync(`${CACHE_FILE}.tmp`, CACHE_FILE);
  } catch (e) { console.warn('[Rush] duration cache not saved:', (e as Error).message); }
}

export const rushStats = { cacheHits: 0, archiveCalls: 0 };
let fetchImpl: typeof fetch = archiveApiFetch;
export function setRushFetchForTests(f?: typeof fetch) { fetchImpl = f ?? archiveApiFetch; cache = {}; snapshotSeeded = true; /* tests never read the packaged snapshot */ rushStats.cacheHits = 0; rushStats.archiveCalls = 0; }

function seconds(v: unknown): number {
  if (typeof v === 'number') return v;
  const s = String(v ?? '');
  if (s.includes(':')) return s.split(':').reduce((t, p) => t * 60 + Number(p), 0);
  return Number(s);
}
const track = (id: string, f: CacheEntry['files'][number]): RushTrack => {
  const archivePath = `/download/${encodeURIComponent(id)}/${f.file.split('/').map(encodeURIComponent).join('/')}`;
  return { ...f, archivePath, mediaUrl: `/api/archive/proxy?path=${encodeURIComponent(archivePath)}` };
};


/** The playable MP3s of one Archive item's metadata: not private, uploaded originals preferred (derivatives only if that is all there is),
 *  known duration, natural filename order. Shared by the live resolver and tools/build-audio-snapshot.ts so both always agree. */
export function filesFromMetadata(meta: any): CacheEntry['files'] {
  const mp3 = (meta?.files ?? []).filter((f: any) => /\.mp3$/i.test(f.name) && String(f.private) !== 'true');
  const originals = mp3.filter((f: any) => f.source === 'original');
  const chosenMp3 = (originals.length ? originals : mp3)
    .map((f: any) => ({ file: String(f.name), durationSeconds: seconds(f.length), size: f.size ? Number(f.size) : undefined, format: f.format }))
    .filter((f: any) => f.durationSeconds > 0)
    .sort((a: any, b: any) => a.file.localeCompare(b.file, undefined, { numeric: true }));
  // Preserve the historical MP3 selection exactly. M4A/AAC are fallbacks only
  // when an item has no admissible, positive-duration MP3.
  if (chosenMp3.length) return chosenMp3;
  for (const extension of ['m4a', 'aac']) {
    const candidates = (meta?.files ?? []).filter((f: any) => new RegExp(`\\.${extension}$`, 'i').test(String(f.name ?? '')) && !/^true$/i.test(String(f.private ?? '')));
    const preferred = candidates.filter((f: any) => f.source === 'original');
    const playable = (preferred.length ? preferred : candidates)
      .map((f: any) => ({ file: String(f.name), durationSeconds: seconds(f.length), size: f.size ? Number(f.size) : undefined, format: f.format }))
      .filter((f: any) => f.durationSeconds > 0)
      .sort((a: any, b: any) => a.file.localeCompare(b.file, undefined, { numeric: true }));
    if (playable.length) return playable;
  }
  return [];
}

/** Packaged snapshot of every whole-item audio channel's tracks (src/data/audioItemSnapshot.json, built by tools/build-audio-snapshot.ts).
 *  A cold server (Cloud Run starts with no disk cache) answers from it with zero Archive calls; anything already in the
 *  live/disk cache wins, and an item missing from the snapshot is still resolved from Archive as before. */
let snapshotSeeded = false;
async function seedSnapshot() {
  if (snapshotSeeded) return;
  snapshotSeeded = true;
  try {
    const mod: any = await import('../src/data/audioItemSnapshot.json');
    const items = (mod.default ?? mod)?.items ?? {};
    const c = loadCache();
    for (const [id, e] of Object.entries<any>(items)) if (!c[id] && Array.isArray(e?.files) && e.files.length) c[id] = { resolvedAt: String(e.resolvedAt ?? ''), files: e.files };
  } catch { /* no snapshot packaged: fall back to Archive */ }
}

/** Files + durations for one Archive item: cache first, Archive metadata on a miss. */
export async function resolveRushItem(id: string): Promise<{ id: string; source: 'cache' | 'archive'; resolvedAt: string; tracks: RushTrack[] }> {
  await seedSnapshot();
  const hit = loadCache()[id];
  if (hit) { rushStats.cacheHits++; return { id, source: 'cache', resolvedAt: hit.resolvedAt, tracks: hit.files.map((f) => track(id, f)) }; }
  rushStats.archiveCalls++;
  // Archive answers 502/ECONNRESET in bursts (seen at boot): retry transient failures before giving up.
  let r: Response | undefined; let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { r = await fetchImpl(`https://archive.org/metadata/${encodeURIComponent(id)}`); if (r.ok || (r.status < 500 && r.status !== 429)) break; }
    catch (e) { lastErr = e; r = undefined; }
    if (attempt < 2) await new Promise((res) => setTimeout(res, attempt === 0 ? 700 : 2000));
  }
  if (!r) throw Object.assign(new Error(`metadata fetch failed: ${(lastErr as Error)?.message ?? 'network'}`), { status: 502 });
  if (!r.ok) throw Object.assign(new Error(`metadata HTTP ${r.status}`), { status: 502 });
  const meta: any = await r.json();
  if (meta?.is_dark || !Array.isArray(meta?.files)) throw Object.assign(new Error('item unavailable'), { status: 404 });
  if (id.includes('morning-update')) {
    const files = meta.files.filter((file: any) => !/^true$/i.test(String(file?.private ?? '')));
    const derivative = files.find((file: any) =>
      file?.format === 'h.264 IA' &&
      String(file?.name ?? '').endsWith('.ia.mp4') &&
      seconds(file?.length) > 0
    );
    // Archive's original MPEG4 uploads tested for the 2014–2016 Morning
    // Updates contain H.264 video + AAC audio. Prefer the standardized IA
    // derivative whenever it exists; use the original only as that fallback.
    const originalMpeg4 = files.find((file: any) =>
      file?.source === 'original' &&
      /^mpeg4$/i.test(String(file?.format ?? '')) &&
      /\.mp4$/i.test(String(file?.name ?? '')) &&
      seconds(file?.length) > 0
    );
    const f = derivative ?? originalMpeg4;
    if (!f) throw new Error('no compatible Morning Update MP4');
    const singleFile = {
      file: String(f.name),
      durationSeconds: seconds(f.length),
      size: f.size ? Number(f.size) : undefined,
      format: f.format,
      kind: 'video',
      role: 'morning-update',
    };
    const entry = { resolvedAt: new Date().toISOString(), files: [singleFile] };
    loadCache()[id] = entry;
    saveCache();
    return { id, source: 'archive', resolvedAt: entry.resolvedAt, tracks: [track(id, singleFile)] };
  }
  const files = filesFromMetadata(meta);
  if (!files.length) throw Object.assign(new Error('no MP3 with a known duration'), { status: 422 });
  const entry = { resolvedAt: new Date().toISOString(), files };
  loadCache()[id] = entry;
  saveCache();
  return { id, source: 'archive', resolvedAt: entry.resolvedAt, tracks: files.map((f: any) => track(id, f)) };
}

export async function rushEpisodesOn(date: string): Promise<RushIndexEntry[]> {
  return DATE.test(date) ? (await getRushIndex()).filter((e) => e.date === date) : [];
}

/** The first indexed date after `date` (not "tomorrow": gaps are normal), or null at the end of the archive. */
export async function nextRushDate(date: string): Promise<string | null> {
  if (!DATE.test(date)) return null;
  let best: string | null = null;
  for (const e of await getRushIndex()) if (e.date > date && (!best || e.date < best)) best = e.date;
  return best;
}
