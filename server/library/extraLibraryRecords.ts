/* Search-only Library records for the @edith377 uploads and the @squidguin movie favorites.
 * Pure (no network, no clock). Reads src/data/extraLibraryManifest.json. Creates NO channels and touches no guide.
 * Same pattern as catalogRecords.ts. Every file answered Range 0-0 with 206 on 2026-11-14 (not a rights judgement).
 * Shows: records of one show share the "Show - Episode" title form and category classic-tv, which the existing
 * groupLibraryResults() already folds into one series. Films/singles stay single records. */
import manifest from '../../src/data/extraLibraryManifest.json';
import type { IndexRecord } from '../libraryIndex';

interface Row { i: string; f: string; t: string; d: number; b: number; c: string; src: string; s?: string; e?: number; k?: string; y?: number }

const segs = (p: string): string => p.split('/').map(encodeURIComponent).join('/');
const extOf = (f: string): string => (/\.([a-z0-9]{2,4})$/i.exec(f)?.[1] ?? 'mp4').toLowerCase();

export function extraLibraryRecords(): IndexRecord[] {
  const rows = (manifest as unknown as { rows: Row[] }).rows ?? [];
  return rows.filter((r) => r?.i && r.f && r.t).map((r): IndexRecord => ({
    id: `ia-${r.i}`, identifier: r.i, title: r.t,
    description: `Archive.org · ${r.src}${r.s ? ` · ${r.s}` : ''}`,
    categoryIds: [r.c], mediaType: 'video',
    year: r.y, decade: r.y ? Math.floor(r.y / 10) * 10 : undefined,
    path: `/download/${encodeURIComponent(r.i)}/${segs(r.f)}`, file: r.f, format: extOf(r.f),
    dur: r.d, durSrc: 'metadata', durEst: false,
    availability: 'unverified', foundBy: 'extraLibraryManifest.json', why: 'Range 206 probe 2026-11-14', indexedAt: '',
    fileSizeBytes: r.b || null, archiveDetailsUrl: `https://archive.org/details/${encodeURIComponent(r.i)}`,
    ...(r.s ? { showLabel: r.s } : {}), ...(r.e !== undefined ? { episodeNumber: r.e } : {}),
    ...(r.k ? { kindBadge: r.k } : {}), sourceFile: 'extraLibraryManifest.json',
  }));
}
