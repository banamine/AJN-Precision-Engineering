/* Rush archive: master index ("what exists") + just-in-time episode resolver
 * ("what files, how long"). The index is a bundled file built offline by
 * scripts/build-rush-index.ts; nothing here searches Archive at runtime.
 * Durations are resolved only for an episode someone asks for, then cached. */
// Namespace imports: the frontend bundle pulls guideRegistry in, and Vite stubs
// node builtins with an empty module that has no named exports.
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { archiveApiFetch } from './archiveLimiter';

export interface RushIndexEntry { id: string; date: string; year: number; }
export interface RushTrack { file: string; durationSeconds: number; size?: number; format?: string; archivePath: string; mediaUrl: string; }
interface CacheEntry { resolvedAt: string; files: Array<Omit<RushTrack, 'archivePath' | 'mediaUrl'>>; }

const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Loaded lazily (dynamic import): the frontend bundle pulls guideRegistry in,
// and a static import would ship the whole index to every browser.
let rushIndexCache: RushIndexEntry[] | null = null;
export async function getRushIndex(): Promise<RushIndexEntry[]> {
  if (!rushIndexCache) {
    const mod: any = await import('../src/data/rushIndex.json');
    rushIndexCache = ((mod.default ?? mod) as RushIndexEntry[]).filter((e) => e && typeof e.id === 'string' && DATE.test(e.date));
  }
  return rushIndexCache;
}

// Durable on a PC/dev box; on Cloud Run it lives only as long as the instance.
const CACHE_FILE = process.env.RUSH_CACHE_FILE || nodePath.join(process.cwd(), '.cache', 'rush-durations.json');
let cache: Record<string, CacheEntry> = {};
try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { cache = {}; }
function saveCache() {
  try {
    fs.mkdirSync(nodePath.join(CACHE_FILE, '..'), { recursive: true });
    fs.writeFileSync(`${CACHE_FILE}.tmp`, JSON.stringify(cache));
    fs.renameSync(`${CACHE_FILE}.tmp`, CACHE_FILE);
  } catch (e) { console.warn('[Rush] duration cache not saved:', (e as Error).message); }
}

export const rushStats = { cacheHits: 0, archiveCalls: 0 };
let fetchImpl: typeof fetch = archiveApiFetch;
export function setRushFetchForTests(f?: typeof fetch) { fetchImpl = f ?? archiveApiFetch; cache = {}; rushStats.cacheHits = 0; rushStats.archiveCalls = 0; }

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

/** Files + durations for one Archive item: cache first, Archive metadata on a miss. */
export async function resolveRushItem(id: string): Promise<{ id: string; source: 'cache' | 'archive'; resolvedAt: string; tracks: RushTrack[] }> {
  const hit = cache[id];
  if (hit) { rushStats.cacheHits++; return { id, source: 'cache', resolvedAt: hit.resolvedAt, tracks: hit.files.map((f) => track(id, f)) }; }
  rushStats.archiveCalls++;
  const r = await fetchImpl(`https://archive.org/metadata/${encodeURIComponent(id)}`);
  if (!r.ok) throw Object.assign(new Error(`metadata HTTP ${r.status}`), { status: 502 });
  const meta: any = await r.json();
  if (meta?.is_dark || !Array.isArray(meta?.files)) throw Object.assign(new Error('item unavailable'), { status: 404 });
  const mp3 = meta.files.filter((f: any) => /\.mp3$/i.test(f.name) && String(f.private) !== 'true');
  // Prefer the uploaded originals; fall back to derivatives (e.g. 64kb) if that is all there is.
  const originals = mp3.filter((f: any) => f.source === 'original');
  const files = (originals.length ? originals : mp3)
    .map((f: any) => ({ file: String(f.name), durationSeconds: seconds(f.length), size: f.size ? Number(f.size) : undefined, format: f.format }))
    .filter((f: any) => f.durationSeconds > 0)
    .sort((a: any, b: any) => a.file.localeCompare(b.file, undefined, { numeric: true }));
  if (!files.length) throw Object.assign(new Error('no MP3 with a known duration'), { status: 422 });
  const entry = { resolvedAt: new Date().toISOString(), files };
  cache[id] = entry;
  saveCache();
  return { id, source: 'archive', resolvedAt: entry.resolvedAt, tracks: files.map((f: any) => track(id, f)) };
}

export async function rushEpisodesOn(date: string): Promise<RushIndexEntry[]> {
  return DATE.test(date) ? (await getRushIndex()).filter((e) => e.date === date) : [];
}
