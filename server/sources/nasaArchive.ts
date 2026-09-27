/* NASA Mission Archive — a video channel built from Archive.org search.
 *  search (bounded) -> metadata (cached per item) -> pick a web-playable file
 *  from Archive's `format` field (not the file extension) -> duration with its
 *  source recorded -> stable order (date, then identifier).
 * The last good lineup is kept when a refresh fails. No Node APIs at import time. */
import type { Program } from '../../src/types';
import { archiveApiFetch } from '../archiveLimiter';

export const NASA_CHANNEL_ID = 'nasa-missions';
export const NASA_QUERY = 'collection:nasa AND mediatype:movies AND (apollo OR gemini OR mercury OR "space shuttle" OR skylab OR spacewalk OR "moon landing")';
const MAX_ITEMS = 40, CONCURRENCY = 3;
export const DEFAULT_DURATION_SECONDS = 1800;
const META_TTL_MS = 7 * 24 * 3600_000;
export const NASA_REFRESH_MS = 24 * 3600_000;

/** Archive `format` values browsers play (H.264/AAC MP4), best first.
 *  Masters and non-web formats (MPEG2, QuickTime, Ogg, DV, AVI…) are never picked. */
export const WEB_VIDEO_FORMATS = ['h.264', 'h.264 IA', 'MPEG4', '512Kb MPEG4'];

export interface ResolvedDuration { seconds: number; source: 'file' | 'runtime' | 'default'; isEstimated: boolean }
export interface SelectedMedia { fileName: string; format: string; archivePath: string; canonicalUrl: string; selectionReason: string }

/** "1823.4", "30:23", "00:30:23", "28 minutes", "1 hr 5 min" -> seconds (0 if unusable). */
export function parseDuration(v: unknown): number {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return 0;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s));
  if (/^\d+(:\d{1,2}){1,2}(\.\d+)?$/.test(s)) return Math.round(s.split(':').reduce((t, p) => t * 60 + Number(p), 0));
  const h = /(\d+(?:\.\d+)?)\s*h/.exec(s), m = /(\d+(?:\.\d+)?)\s*m/.exec(s), sec = /(\d+)\s*s/.exec(s);
  const total = (h ? Number(h[1]) * 3600 : 0) + (m ? Number(m[1]) * 60 : 0) + (sec ? Number(sec[1]) : 0);
  return Number.isFinite(total) ? Math.round(total) : 0;
}

export function resolveDuration(file: any, meta: any, fallback = DEFAULT_DURATION_SECONDS): ResolvedDuration {
  const f = parseDuration(file?.length);
  if (f > 0) return { seconds: f, source: 'file', isEstimated: false };
  const r = parseDuration(meta?.metadata?.runtime);
  if (r > 0) return { seconds: r, source: 'runtime', isEstimated: false };
  return { seconds: fallback, source: 'default', isEstimated: true };
}

export function selectVideoFile(identifier: string, meta: any): SelectedMedia | null {
  const files: any[] = Array.isArray(meta?.files) ? meta.files : [];
  const ok = files.filter((f) => typeof f?.name === 'string' && /\.mp4$/i.test(f.name) && String(f.private) !== 'true' && WEB_VIDEO_FORMATS.includes(String(f.format)));
  if (!ok.length) return null;
  ok.sort((a, b) => WEB_VIDEO_FORMATS.indexOf(String(a.format)) - WEB_VIDEO_FORMATS.indexOf(String(b.format)) || String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
  const f = ok[0];
  const archivePath = `/download/${encodeURIComponent(identifier)}/${String(f.name).split('/').map(encodeURIComponent).join('/')}`;
  return { fileName: f.name, format: String(f.format), archivePath, canonicalUrl: `https://archive.org${archivePath}`, selectionReason: `format ${f.format} (rank ${WEB_VIDEO_FORMATS.indexOf(String(f.format)) + 1} of ${WEB_VIDEO_FORMATS.length})` };
}

const metaCache = new Map<string, { at: number; meta: any }>();
export const nasaStats = { searches: 0, searchFailures: 0, cacheHits: 0, cacheMisses: 0, metadataFailures: 0, unsupported: 0, estimatedDurations: 0, lastOk: null as string | null, lastError: null as string | null };
let fetchImpl: typeof fetch = archiveApiFetch;
export function setNasaFetchForTests(f?: typeof fetch) { fetchImpl = f ?? archiveApiFetch; metaCache.clear(); lineup = null; refreshing = null; lastAttempt = 0; for (const k of Object.keys(nasaStats)) (nasaStats as any)[k] = typeof (nasaStats as any)[k] === 'number' ? 0 : null; }

async function getMeta(id: string, now: number): Promise<any | null> {
  const hit = metaCache.get(id);
  if (hit && now - hit.at < META_TTL_MS) { nasaStats.cacheHits++; return hit.meta; }
  nasaStats.cacheMisses++;
  try {
    const r = await fetchImpl(`https://archive.org/metadata/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const meta = await r.json();
    if (meta?.is_dark) throw new Error('item unavailable');
    metaCache.set(id, { at: now, meta });
    return meta;
  } catch { nasaStats.metadataFailures++; return hit?.meta ?? null; }
}

export async function buildNasaPrograms(guideId: string, now = Date.now()): Promise<Program[]> {
  nasaStats.searches++;
  const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(NASA_QUERY)}&fl[]=identifier&fl[]=title&fl[]=date&fl[]=year&fl[]=description&rows=${MAX_ITEMS}&sort[]=downloads+desc&output=json`;
  const r = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) { nasaStats.searchFailures++; throw new Error(`NASA search HTTP ${r.status}`); }
  const docs: any[] = (await r.json())?.response?.docs ?? [];
  const seen = new Set<string>();
  const unique = docs.filter((d) => typeof d?.identifier === 'string' && !seen.has(d.identifier) && seen.add(d.identifier)).slice(0, MAX_ITEMS);
  const out: Program[] = [];
  let i = 0;
  const results: Array<Program | null> = new Array(unique.length);
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, async () => {
    while (i < unique.length) {
      const k = i++; const d = unique[k];
      const meta = await getMeta(d.identifier, now);
      const media = meta && selectVideoFile(d.identifier, meta);
      if (!media) { if (meta) nasaStats.unsupported++; results[k] = null; continue; }
      const file = meta.files.find((f: any) => f.name === media.fileName);
      const duration = resolveDuration(file, meta);
      if (duration.isEstimated) nasaStats.estimatedDurations++;
      const desc = String(d.description ?? meta.metadata?.description ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 300);
      results[k] = {
        id: `nasa-${d.identifier}`, guideId, channelId: NASA_CHANNEL_ID,
        title: String(d.title ?? meta.metadata?.title ?? d.identifier), description: desc || 'NASA mission film from the Internet Archive.',
        startTime: 0, endTime: 0, mediaType: 'video', mediaUrl: media.archivePath, archivePath: media.archivePath,
        sourceClass: 'archive_org', isArchivedSource: true,
        sourceId: `archive:${d.identifier}`, assetId: `archive:${d.identifier}/${media.fileName}`,
        metadata: { identifier: d.identifier, file: media.fileName, format: media.format, selectionReason: media.selectionReason, canonicalUrl: media.canonicalUrl,
          durationSeconds: duration.seconds, durationSource: duration.source, durationEstimated: duration.isEstimated,
          year: String(d.year ?? String(d.date ?? '').slice(0, 4) ?? ''), date: d.date, tags: ['nasa', 'space', 'aerospace'] },
      } as Program;
    }
  }));
  for (const p of results) if (p) out.push(p);
  // Stable order: air/publication date, then identifier (independent of search ranking).
  out.sort((a, b) => String((a.metadata as any).date ?? '9999').localeCompare(String((b.metadata as any).date ?? '9999')) || a.id.localeCompare(b.id));
  return out;
}

let lineup: { at: number; programs: Program[] } | null = null;
let refreshing: Promise<void> | null = null;
let lastAttempt = 0;
const RETRY_AFTER_FAILURE_MS = 10 * 60_000; // a failing Archive is not asked again on every guide request
async function refresh(guideId: string) {
  lastAttempt = Date.now();
  try {
    const programs = await buildNasaPrograms(guideId);
    if (!programs.length) throw new Error('no playable items');
    lineup = { at: Date.now(), programs }; nasaStats.lastOk = new Date().toISOString(); nasaStats.lastError = null;
  } catch (e: any) { nasaStats.lastError = String(e?.message ?? e); } // last good lineup stays
}
/** Current lineup; the first call waits up to `waitMs`, later calls never wait. */
export async function getNasaPrograms(guideId: string, waitMs = 8000): Promise<{ programs: Program[]; loading: boolean; error: string | null }> {
  const due = !lineup ? Date.now() - lastAttempt > RETRY_AFTER_FAILURE_MS || lastAttempt === 0 : Date.now() - lineup.at > NASA_REFRESH_MS && Date.now() - lastAttempt > RETRY_AFTER_FAILURE_MS;
  if (due) refreshing ??= refresh(guideId).finally(() => { refreshing = null; });
  if (!lineup && refreshing) await Promise.race([refreshing, new Promise((ok) => { const t = setTimeout(ok, waitMs); (t as any)?.unref?.(); })]);
  return { programs: lineup?.programs ?? [], loading: !lineup && !!refreshing, error: nasaStats.lastError };
}
