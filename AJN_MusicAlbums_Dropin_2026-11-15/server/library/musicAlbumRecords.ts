/* Search-only Library records: one per @only2try "VA - ..." album (SoundBible excluded). Every song is a part,
 * so song names are searchable (librarySearchFields indexes parts[].file). Creates NO channels, touches no guide.
 * Durations for tracks without Archive metadata are ESTIMATES (size*8/136000 s, measured median 136 kbps); durEst flags them. */
import manifest from '../../src/data/musicAlbumsManifest.json';
import type { IndexRecord } from '../libraryIndex';
import type { SeriesFile } from './series';

type Tr = [string, number, number, number];
interface Album { i: string; t: string; g?: string; y?: number; tr: Tr[] }

const segs = (p: string): string => p.split('/').map(encodeURIComponent).join('/');

export function musicAlbumRecords(): IndexRecord[] {
  const albums = (manifest as unknown as { albums: Album[] }).albums ?? [];
  const out: IndexRecord[] = [];
  for (const a of albums) {
    if (!a?.i || !a.t || !a.tr?.length) continue;
    const parts: SeriesFile[] = a.tr.map(([f, b, d], n) => ({
      id: `album:${a.i}::${n + 1}`, identifier: a.i, file: f, path: `/download/${encodeURIComponent(a.i)}/${segs(f)}`,
      durationSeconds: d, bytes: b, part: { number: n + 1, total: a.tr.length },
    }));
    const est = a.tr.some((t) => t[3] === 1);
    out.push({
      id: `album:${a.i}`, identifier: a.i, title: a.t,
      description: `Archive.org · Various Artists album${a.g ? ` · ${a.g}` : ''} · ${a.tr.length} songs${est ? ' · lengths estimated' : ''}`,
      categoryIds: ['music-albums'], mediaType: 'audio', year: a.y, decade: a.y ? Math.floor(a.y / 10) * 10 : undefined,
      path: parts[0].path, file: parts[0].file, format: 'opus',
      dur: parts.reduce((n, p) => n + p.durationSeconds, 0), durSrc: 'metadata', durEst: est,
      availability: 'unverified', foundBy: 'musicAlbumsManifest.json', why: 'only2try VA albums 2026-11-15', indexedAt: '',
      kindBadge: 'Album', sourceFile: 'musicAlbumsManifest.json', searchTerms: ['VA', 'various artists', 'music album', ...(a.g ? [a.g] : [])], parts,
    });
  }
  return out;
}
