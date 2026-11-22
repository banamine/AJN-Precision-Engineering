/* Library music for On Air (the failover source, and the "Library" mode). Real tracks from the music albums manifest; nothing invented.
 * A block's track list is a pure function of the block id, so every viewer of the same block gets the same tracks. */
import { cleanArchiveMusicFilename } from '../utils/archiveMusicTitle';
import { fnv1a } from '../utils/roundRobinSchedule';
import type { OnAirParams } from './runOfShow';

export interface LibAlbum { i: string; t: string; g?: string; tr: [string, number, number, number][] }
export interface LibTrack { src: string; title: string; artist: string; album: string; durationMs: number; estimated: boolean }

const segs = (p: string): string => p.split('/').map(encodeURIComponent).join('/');

/** Loads the manifest on demand (it is large), so the On Air page's first paint never waits for it. */
export async function loadLibraryAlbums(signal?: AbortSignal): Promise<LibAlbum[]> {
  const mod = await import('../data/musicAlbumsManifest.json');
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  const albums = (mod.default as unknown as { albums?: LibAlbum[] }).albums ?? [];
  return albums.filter((a) => a && a.i && Array.isArray(a.tr) && a.tr.length >= 3);
}

/** Tracks for one music block: a deterministic album and starting track, as many tracks as it takes to pass the block's maximum length. */
export function pickBlockTracks(albums: readonly LibAlbum[], blockId: string, params: Pick<OnAirParams, 'musicMaxSec'>): LibTrack[] {
  if (!albums.length) return [];
  const h = fnv1a(blockId);
  const album = albums[h % albums.length];
  const files = album.tr;
  const start = Math.floor(h / 7) % files.length;
  const out: LibTrack[] = [];
  let total = 0;
  for (let k = 0; k < files.length && total < params.musicMaxSec * 1000; k++) {
    const [file, , seconds, est] = files[(start + k) % files.length];
    if (!(seconds > 0)) continue;
    const t = cleanArchiveMusicFilename(file);
    out.push({ src: `/download/${encodeURIComponent(album.i)}/${segs(file)}`, title: t.title || file, artist: t.artist || '', album: album.t, durationMs: Math.round(seconds * 1000), estimated: !!est });
    total += seconds * 1000;
  }
  return out;
}
