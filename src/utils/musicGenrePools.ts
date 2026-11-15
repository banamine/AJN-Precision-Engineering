/* Archive Music deck pools by GENRE (same shape as loadConcertPools): "All music" + one pool per genre.
 * Items: the existing Archive Music channels (genre from musicGenre.ts) + the 301 @only2try VA albums (genre `g` in the manifest).
 * Track keys stay `<archiveId>::<partNo>`. Durations: only REAL lengths are kept; estimated ones stay undefined, so a pool with
 * estimated albums is Shuffle-only (never a fake clock). Loaded on demand (the albums manifest is 1.8 MB). */
import { buildMusicPools } from './scheduleCatalog.ts';
import { genreForName, type MusicGenre } from './musicGenre.ts';
import type { SchedItem, SchedPool, SchedTrack } from './roundRobinSchedule.ts';

const MAX_TRACKS = 300;
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const segs = (p: string): string => p.split('/').map(encodeURIComponent).join('/');
const baseName = (f: string): string => f.split('/').pop()!.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/^\d+\s*[.\-)]\s*/, '').trim() || f;

export const GENRE_LABEL: Record<MusicGenre, string> = {
  easy: 'Chill, Lounge & Relax', rock: 'Rock & Metal', pop: 'Pop & Hits', hits: 'Pop & Hits', jazz: 'Jazz, Blues & Soul', dance: 'House & Dance',
  disco: 'Disco & Italo', country: 'Country & Folk', classical: 'Classical & Instrumental', soundtrack: 'Soundtracks', love: 'Love & Romance',
  live: 'Oldies & Live', oldies: 'Oldies & Live', default: 'More Music',
};

interface Album { i: string; t: string; g?: string; tr: [string, number, number, number][] }

export function albumItems(albums: readonly Album[], poolIdFor: (genre: string) => string): { genre: string; item: SchedItem }[] {
  return albums.filter((a) => a?.i && a.tr?.length).map((a) => {
    const genre = a.g || 'Pop & Hits'; const poolId = poolIdFor(genre);
    const files = a.tr.slice(0, MAX_TRACKS);
    const tracks: SchedTrack[] = files.map(([f, , d, est], i) => ({ programId: `${a.i}::${i + 1}`, archiveId: a.i, partNo: i + 1, bank: 'music', poolId,
      channelId: `music-pool-${slug(genre)}`, guideId: 'audio-podcasts', title: baseName(f), subtitle: a.t,
      src: `/download/${encodeURIComponent(a.i)}/${segs(f)}`, durationSeconds: est ? undefined : d }));
    return { genre, item: { id: a.i, tracks } };
  });
}

export function groupByGenre(channelPools: readonly SchedPool[], albums: readonly Album[]): SchedPool[] {
  const byGenre = new Map<string, SchedItem[]>();
  const poolId = (g: string): string => `music-genre-${slug(g)}`;
  const add = (g: string, it: SchedItem): void => { const l = byGenre.get(g) ?? []; l.push(it); byGenre.set(g, l); };
  for (const p of channelPools) {
    const g = GENRE_LABEL[genreForName(p.label)];
    for (const it of p.items) add(g, { ...it, tracks: it.tracks.map((t) => ({ ...t, poolId: poolId(g) })) });
  }
  for (const { genre, item } of albumItems(albums, poolId)) add(genre, item);
  const genres: SchedPool[] = [...byGenre.entries()].filter(([, items]) => items.length).map(([g, items]) => ({ id: poolId(g), label: g, bank: 'music' as const, items }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const all = genres.flatMap((p) => p.items);
  return [{ id: 'music-all', label: 'All music', bank: 'music', items: all }, ...genres];
}

export async function loadMusicPools(): Promise<SchedPool[]> {
  const mod = await import('../data/musicAlbumsManifest.json');
  return groupByGenre(buildMusicPools(), (mod.default as unknown as { albums: Album[] }).albums ?? []);
}
