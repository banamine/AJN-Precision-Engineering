/* The Listen catalog: Archive Music channels, Live Concerts and archived Podcast episodes, adapted from the data
 * files the server already ships (archiveAudioChannels, audioItemSnapshot, concertPoolsManifest, podcastArchiveEpisodes).
 * Pure: no network, no clock. Anything without real files is left out and counted, never faked. */
import archiveAudioChannels from '../data/archiveAudioChannels.json';
import audioItemSnapshot from '../data/audioItemSnapshot.json';
import podcastEpisodes from '../data/podcastArchiveEpisodes.json';
import podcastSources from '../data/podcastSources.json';
import { genreForName } from './musicGenre.ts';
import type { PlanItem } from './ajnShowGroups.ts';
import type { AudioBank } from './audioPresets.ts';

export interface ListenItem {
  id: string;
  bank: AudioBank;
  title: string;
  subtitle: string;
  genre: string;
  channelId: string;
  guideId: string;
  /** The real files, in play order, as archive paths (/download/<item>/<file>). Empty = nothing playable. */
  tracks: () => PlanItem[];
  trackCount: number;
}

const MAX_TRACKS = 300;
const segs = (path: string): string => path.split('/').map(encodeURIComponent).join('/');
const dl = (item: string, file: string): string => `/download/${encodeURIComponent(item)}/${segs(file)}`;
const baseName = (file: string): string => file.split('/').pop()!.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/^\d+\s*[.\-)]\s*/, '').trim() || file;

function plan(id: string, files: { path: string; title: string; item: string }[]): PlanItem[] {
  const list = files.slice(0, MAX_TRACKS);
  return list.map((f, i) => ({ src: dl(f.item, f.path), mediaType: 'audio' as const, programId: `${id}::${i + 1}`, title: f.title, partNo: i + 1, totalParts: list.length }));
}

interface AudioChannel { id: string; name: string; group: string; itemId: string }
interface SnapshotFile { file: string; format?: string }
const AUDIO_EXT = /\.(mp3|ogg|m4a|flac|wav|opus)$/i;

export interface MusicCatalog { items: ListenItem[]; withoutFiles: string[] }
export function buildMusicItems(): MusicCatalog {
  const snap = (audioItemSnapshot as unknown as { items: Record<string, { files?: SnapshotFile[] }> }).items;
  const items: ListenItem[] = [];
  const withoutFiles: string[] = [];
  for (const ch of archiveAudioChannels as AudioChannel[]) {
    if (ch.group !== 'Music') continue;
    const files = (snap[ch.itemId]?.files ?? []).filter((f) => AUDIO_EXT.test(f.file));
    if (!files.length) { withoutFiles.push(ch.name); continue; }
    const list = files.map((f) => ({ path: f.file, title: baseName(f.file), item: ch.itemId }));
    items.push({ id: ch.id, bank: 'music', title: ch.name, subtitle: `${files.length} track${files.length === 1 ? '' : 's'}`, genre: genreForName(ch.name), channelId: ch.id, guideId: 'audio-podcasts', trackCount: Math.min(files.length, MAX_TRACKS), tracks: () => plan(ch.id, list) });
  }
  return { items: items.sort((a, b) => a.title.localeCompare(b.title)), withoutFiles };
}

/** Archived podcast episodes that really exist as files. Other subscribed feeds are resolved by the server per episode and are not listed here. */
export function buildPodcastItems(): ListenItem[] {
  const eps = podcastEpisodes as unknown as Record<string, { item: string; episodes: { path: string; title: string }[] }>;
  const shows = new Map((podcastSources as unknown as { sources: { id: string; name: string }[] }).sources.map((s) => [s.id, s.name]));
  const out: ListenItem[] = [];
  for (const [showId, v] of Object.entries(eps)) {
    const show = shows.get(showId) ?? showId;
    v.episodes.forEach((e, i) => {
      const id = `podcast-${showId}-${i + 1}`;
      out.push({ id, bank: 'podcasts', title: e.title, subtitle: show, genre: show, channelId: `podcast-${showId}`, guideId: 'audio-podcasts', trackCount: 1, tracks: () => plan(id, [{ path: e.path, title: e.title, item: v.item }]) });
    });
  }
  return out;
}

interface ConcertPool { id: string; name: string; genre: string; concerts: { id: string; title: string; date?: string; tracks: { f: string; t: string; n?: number }[] }[] }
/** Loaded on demand (the manifest is 1.5 MB): 7 genre pools flattened to one item per concert. */
export async function loadConcertItems(): Promise<ListenItem[]> {
  const mod = await import('../data/concertPoolsManifest.json');
  const pools = (mod.default as unknown as { pools: ConcertPool[] }).pools;
  const out: ListenItem[] = [];
  for (const pool of pools) {
    for (const c of pool.concerts) {
      if (!c.tracks?.length) continue;
      const id = `concert-${c.id}`;
      const year = c.date ? c.date.slice(0, 4) : '';
      out.push({ id, bank: 'concerts', title: c.title, subtitle: `${pool.genre}${year ? ` · ${year}` : ''} · ${c.tracks.length} tracks`, genre: pool.genre, channelId: `concert-pool-${pool.genre.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, guideId: 'audio-podcasts', trackCount: Math.min(c.tracks.length, MAX_TRACKS), tracks: () => plan(id, c.tracks.map((t) => ({ path: t.f, title: t.t || baseName(t.f), item: c.id }))) });
    }
  }
  return out;
}

/** Instant client-side search + genre filter. Empty query and genre = everything. */
export function filterListenItems(items: readonly ListenItem[], query: string, genre: string): ListenItem[] {
  const q = query.trim().toLowerCase();
  return items.filter((i) => (!genre || i.genre === genre) && (!q || i.title.toLowerCase().includes(q) || i.subtitle.toLowerCase().includes(q)));
}
export const listenGenres = (items: readonly ListenItem[]): string[] => [...new Set(items.map((i) => i.genre))].sort((a, b) => a.localeCompare(b));
