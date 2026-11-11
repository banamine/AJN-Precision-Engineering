/* Step 3 of the media registry: the concerts, FM broadcasts and archived podcast episodes as Library IndexRecords.
 * Pure (no network, no clock). Every field comes from the shipped data files; nothing is guessed or invented.
 * These records are NOT probed: availability stays 'unverified' because nobody has checked the files. */
import concertManifest from '../../src/data/concertPoolsManifest.json';
import fmData from '../../src/data/fmBroadcastChannels.json';
import podcastEpisodes from '../../src/data/podcastArchiveEpisodes.json';
import podcastSources from '../../src/data/podcastSources.json';
import type { IndexRecord } from '../libraryIndex';
import type { SeriesFile } from './series';

export const CATALOG_CATEGORY_IDS = ['concerts', 'fm-broadcasts', 'podcast-episodes'] as const;
export const isCatalogRecord = (r: { categoryIds: string[] }): boolean => r.categoryIds.some((c) => (CATALOG_CATEGORY_IDS as readonly string[]).includes(c));

interface Track { f: string; t?: string; d?: number; b?: number; n?: number }
interface Concert { id: string; title: string; date?: string; creator?: string; tracks?: Track[] }

const segs = (p: string): string => p.split('/').map(encodeURIComponent).join('/');
const dl = (item: string, file: string): string => `/download/${encodeURIComponent(item)}/${segs(file)}`;
const yearOf = (date?: string): number | undefined => { const m = /^(\d{4})/.exec(date ?? ''); return m ? Number(m[1]) : undefined; };
const extOf = (f: string): string => (/\.([a-z0-9]{2,4})$/i.exec(f)?.[1] ?? 'mp3').toLowerCase();

function toRecord(opts: { idPrefix: string; categoryId: string; item: string; c: Concert; description: string; badge: string; why: string; sourceFile: string }): IndexRecord | null {
  const tracks = (opts.c.tracks ?? []).filter((t) => t?.f);
  if (!tracks.length) return null;
  const parts: SeriesFile[] = tracks.map((t, i) => ({
    id: `${opts.idPrefix}:${opts.c.id}::${i + 1}`, identifier: opts.item, file: t.f, path: dl(opts.item, t.f),
    durationSeconds: t.d ?? 0, bytes: t.b ?? 0, part: { number: i + 1, total: tracks.length },
  }));
  const dur = parts.reduce((n, p) => n + p.durationSeconds, 0);
  const year = yearOf(opts.c.date);
  return {
    id: `${opts.idPrefix}:${opts.c.id}`, identifier: opts.item, title: opts.c.title, description: opts.description,
    categoryIds: [opts.categoryId], mediaType: 'audio', year, decade: year ? Math.floor(year / 10) * 10 : undefined,
    path: parts[0].path, file: parts[0].file, format: extOf(parts[0].file),
    dur, durSrc: 'metadata', durEst: false, availability: 'unverified', foundBy: opts.sourceFile, why: opts.why, indexedAt: '',
    originalCreator: opts.c.creator || undefined, kindBadge: opts.badge, sourceFile: opts.sourceFile, parts,
  };
}

export function catalogRecords(): IndexRecord[] {
  const out: IndexRecord[] = [];
  for (const pool of (concertManifest as unknown as { pools: { genre: string; concerts: Concert[] }[] }).pools) {
    for (const c of pool.concerts) {
      const r = toRecord({ idPrefix: 'concert', categoryId: 'concerts', item: c.id, c, description: `Live concert · ${pool.genre}`, badge: 'Concert', why: 'concert manifest', sourceFile: 'concertPoolsManifest.json' });
      if (r) out.push(r);
    }
  }
  for (const b of (fmData as unknown as { broadcasts: Concert[] }).broadcasts) {
    const r = toRecord({ idPrefix: 'fm', categoryId: 'fm-broadcasts', item: b.id, c: b, description: `FM broadcast${b.creator ? ` · ${b.creator}` : ''}`, badge: 'FM', why: 'FM broadcast manifest', sourceFile: 'fmBroadcastChannels.json' });
    if (r) out.push(r);
  }
  const names = new Map((podcastSources as unknown as { sources: { id: string; name: string }[] }).sources.map((s) => [s.id, s.name]));
  for (const [showId, v] of Object.entries(podcastEpisodes as unknown as Record<string, { item: string; episodes: { path: string; title: string; bytes?: number; durationSeconds?: number }[] }>)) {
    v.episodes.forEach((e, i) => {
      const r = toRecord({ idPrefix: 'podcast', categoryId: 'podcast-episodes', item: v.item, c: { id: `${showId}-${i + 1}`, title: e.title, tracks: [{ f: e.path, d: e.durationSeconds, b: e.bytes }] },
        description: `Podcast · ${names.get(showId) ?? showId}`, badge: 'Podcast', why: 'archived podcast episodes', sourceFile: 'podcastArchiveEpisodes.json' });
      if (r) out.push(r);
    });
  }
  return out;
}
