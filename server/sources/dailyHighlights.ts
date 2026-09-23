// Classic TV from the Archive item "daily-highlights". JSON metadata API only:
// every file is listed by /metadata/daily-highlights, folders included.
//  - .m3u/.m3u8 files are fetched and parsed (layer 1 parser); one channel per show.
//  - .mp4 files sitting directly in a folder become a channel named after that folder.
// Links inside the M3Us are used exactly as written.
import type { Program } from '../../src/types';
import { normalizeAssetIdentity, normalizeProgramIdentity, normalizeSourceIdentity } from '../../src/utils/epgIdentity';
import { buildArchiveProxyUrl } from '../../src/utils/archivePlayback';
import { episodeKey, parseM3uEntries } from './classicM3u';
import { playableUrl, slug } from './archiveLinks';
import type { RejectedItem, SourceContract, SourceResult } from './contract';

export const DAILY_HIGHLIGHTS_ITEM = 'daily-highlights';
const MAX_PLAYLISTS = 60;
const CONCURRENCY = 6;

interface ArchiveFile { name: string; source?: string; format?: string; length?: string; private?: string | boolean }
export interface HighlightsInput { guideId: string; item?: string; fetchImpl?: typeof fetch }
export interface HighlightChannel { id: string; name: string; programs: Program[] }

const encodePath = (name: string) => name.split('/').map(encodeURIComponent).join('/');
const isPrivate = (f: ArchiveFile) => f.private === true || String(f.private).toLowerCase() === 'true';

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

/** Group programs into channels by metadata.show. */
export function toChannels(programs: Program[]): HighlightChannel[] {
  const map = new Map<string, HighlightChannel>();
  for (const p of programs) {
    const show = String((p.metadata as any)?.show ?? 'Unsorted');
    const id = p.channelId;
    if (!map.has(id)) map.set(id, { id, name: show, programs: [] });
    map.get(id)!.programs.push(p);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export const dailyHighlightsContract: SourceContract<HighlightsInput> = {
  sourceClass: 'classic_m3u',
  priority: 1,
  async hook(input, ctx): Promise<SourceResult> {
    const fetchImpl = input.fetchImpl ?? fetch;
    const item = input.item ?? DAILY_HIGHLIGHTS_ITEM;
    const base = { sourceClass: 'classic_m3u' as const, fetchedAt: ctx.now.toISOString() };
    const programs: Program[] = [];
    const rejected: RejectedItem[] = [];
    const headers = { 'User-Agent': 'AJN-Precision-Engineering/DailyHighlights' };

    const metaRes = await fetchImpl(`https://archive.org/metadata/${encodeURIComponent(item)}`, { signal: ctx.signal, headers });
    if (!metaRes.ok) {
      await metaRes.body?.cancel().catch(() => {});
      return { ...base, status: 'upstream_error', programs, rejected, error: `metadata HTTP ${metaRes.status}` };
    }
    const files: ArchiveFile[] = ((await metaRes.json()) as { files?: ArchiveFile[] }).files ?? [];
    const seen = new Set<string>();
    const add = (p: Program) => { if (!seen.has(p.id)) { seen.add(p.id); programs.push(p); } };

    // 1. Playlists.
    const playlists = files.filter((f) => /\.m3u8?$/i.test(f.name) && !isPrivate(f)).slice(0, MAX_PLAYLISTS);
    const texts = await pool(playlists, CONCURRENCY, async (f) => {
      try {
        const r = await fetchImpl(`https://archive.org/download/${item}/${encodePath(f.name)}`, { signal: ctx.signal, headers });
        if (!r.ok) { await r.body?.cancel().catch(() => {}); return { f, error: `HTTP ${r.status}` }; }
        return { f, text: await r.text() };
      } catch (err: any) { return { f, error: String(err?.message ?? err) }; }
    });
    for (const t of texts) {
      if (!('text' in t) || t.text === undefined) { rejected.push({ id: t.f.name, reason: `playlist ${t.error}` }); continue; }
      for (const entry of parseM3uEntries(t.text)) {
        const key = episodeKey(entry);
        const show = key.show === 'Unsorted' ? t.f.name.split('/').pop()!.replace(/\.m3u8?$/i, '') : key.show;
        const channelId = `classic-${slug(show)}`;
        const { mediaUrl, archivePath } = playableUrl(entry.url);
        if (!/^(https?:\/\/|\/api\/archive\/proxy)/i.test(mediaUrl)) { rejected.push({ id: entry.url, reason: 'unsupported URL' }); continue; }
        const externalId = key.season !== undefined ? `${show}|S${key.season}E${key.episode}` : `${show}|${entry.url}`;
        const programId = normalizeProgramIdentity({ externalId, channelId, title: entry.title, startTime: 0 });
        add({
          id: programId, guideId: input.guideId, channelId, title: entry.title || show, description: show,
          startTime: 0, endTime: 0, mediaType: 'video', mediaUrl, archivePath,
          assetId: normalizeAssetIdentity({ externalId, programId, mediaUrl: archivePath ?? entry.url }),
          sourceId: normalizeSourceIdentity({ channelId, url: `archive:${item}/${t.f.name}`, protocol: 'm3u' }),
          sourceClass: 'archive_org', isArchivedSource: true,
          metadata: { externalId, show, season: key.season, episode: key.episode, durationSeconds: entry.duration > 0 ? entry.duration : undefined, logo: entry.tvgLogo },
        } as Program);
      }
    }

    // 2. Loose MP4s inside folders (derivatives preferred when both exist).
    const mp4 = files.filter((f) => /\.mp4$/i.test(f.name) && f.name.includes('/') && !isPrivate(f));
    for (const f of mp4) {
      const parts = f.name.split('/');
      const show = parts[parts.length - 2];
      const channelId = `classic-${slug(show)}`;
      const archivePath = `/download/${item}/${encodePath(f.name)}`;
      const title = parts[parts.length - 1].replace(/\.mp4$/i, '');
      const externalId = `${item}/${f.name}`;
      const programId = normalizeProgramIdentity({ externalId, channelId, title, startTime: 0 });
      add({
        id: programId, guideId: input.guideId, channelId, title, description: show,
        startTime: 0, endTime: 0, mediaType: 'video', mediaUrl: buildArchiveProxyUrl(archivePath), archivePath,
        assetId: normalizeAssetIdentity({ externalId, archiveIdentifier: item, programId, mediaUrl: archivePath }),
        sourceId: normalizeSourceIdentity({ channelId, url: `archive:${item}/${show}`, protocol: 'direct_archive' }),
        sourceClass: 'archive_org', isArchivedSource: true,
        metadata: { externalId, show, durationSeconds: Number(f.length) > 0 ? Number(f.length) : undefined },
      } as Program);
    }

    const status: SourceResult['status'] = programs.length > 0 ? (rejected.length ? 'partial' : 'ok') : rejected.length ? 'upstream_error' : 'ok';
    return { ...base, status, programs, rejected, ...(programs.length === 0 && rejected.length ? { error: rejected[0].reason } : {}) };
  },
};
