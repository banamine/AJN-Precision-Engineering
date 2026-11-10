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
  /** When the episode was PUBLISHED (epoch ms, parsed on the server from the feed's pubDate). Only set for dated podcast episodes; never invented. */
  publishedAt?: number;
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

interface SpokenProgram { id: string; title: string; mediaUrl?: string; description?: string; metadata?: { airedUtc?: string; podcast?: boolean; backCatalog?: boolean } }
interface SpokenChannel { id: string; name: string; group?: string; sourceStatus?: string; sourceError?: string; programs?: SpokenProgram[] }
const SPOKEN_GROUPS = new Set(['Podcast', 'Talk Radio', 'Old-Time Radio']);
export interface SpokenCatalog { items: ListenItem[]; feedsDown: { name: string; reason: string }[] }
/** Pure: the Podcasts bank from the server's Audio & Podcasts guide (live podcast feeds, talk radio, old-time radio).
 *  A feed the server could not read is reported in feedsDown, never faked. Programs without a media URL are left out. */
export function buildSpokenItems(channels: readonly SpokenChannel[]): SpokenCatalog {
  const items: ListenItem[] = [];
  const feedsDown: { name: string; reason: string }[] = [];
  for (const ch of channels) {
    if (!ch.group || !SPOKEN_GROUPS.has(ch.group)) continue;
    // The schedule lists every airing, so one episode can appear many times. Keep the first airing of each audio file.
    const seenMedia = new Set<string>();
    const progs = (ch.programs ?? []).filter((p) => {
      if (!p.mediaUrl || !p.title) return false;
      if (seenMedia.has(p.mediaUrl)) return false;
      seenMedia.add(p.mediaUrl);
      return true;
    });
    if (ch.group === 'Podcast' && progs.length === 0) { feedsDown.push({ name: ch.name, reason: ch.sourceError ?? ch.sourceStatus ?? 'no episodes' }); continue; }
    // A daily podcast airs several editions a day. Show one box per programme whose tracks are that day's
    // editions, oldest first, so one press plays the whole day in order (the same shape Archive Music uses).
    const airedAt = (pr: SpokenProgram): number => {
      const at = ch.group === 'Podcast' && pr.metadata?.podcast && !pr.metadata?.backCatalog ? Date.parse(pr.metadata?.airedUtc ?? '') : NaN;
      return Number.isFinite(at) && at > Date.UTC(2000, 0, 1) ? at : NaN;
    };
    const dated = progs.map((pr) => ({ pr, at: airedAt(pr) })).filter((x) => Number.isFinite(x.at));
    if (ch.group === 'Podcast' && dated.length > 0) {
      const dayOf = (ms: number): number => { const d = new Date(ms); return d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate(); };
      const newest = Math.max(...dated.map((x) => x.at));
      const editions = dated.filter((x) => dayOf(x.at) === dayOf(newest)).sort((a, b) => a.at - b.at);
      const parts: PlanItem[] = editions.map((x, i) => ({
        src: x.pr.mediaUrl as string, mediaType: 'audio' as const, programId: x.pr.id,
        title: x.pr.title, partNo: i + 1, totalParts: editions.length,
      }));
      items.push({
        id: `spoken-show-${ch.id}`, bank: 'podcasts', title: ch.name,
        subtitle: `${editions.length} edition${editions.length === 1 ? '' : 's'}`,
        genre: ch.group, channelId: ch.id, guideId: 'audio-podcasts',
        trackCount: editions.length, publishedAt: newest, tracks: () => parts,
      });
      continue;
    }
    for (const pr of progs) {
      const id = `spoken-${pr.id}`;
      // Only a real feed episode carries a publish date. Talk-radio / old-time-radio rows and Archive back-catalog have none (their slot times are not air dates).
      const pub = ch.group === 'Podcast' && pr.metadata?.podcast && !pr.metadata?.backCatalog ? Date.parse(pr.metadata?.airedUtc ?? '') : NaN;
      items.push({ id, bank: 'podcasts', title: pr.title, subtitle: ch.name, genre: ch.group, channelId: ch.id, guideId: 'audio-podcasts', trackCount: 1,
        ...(Number.isFinite(pub) && pub > Date.UTC(2000, 0, 1) ? { publishedAt: pub } : {}),
        tracks: () => [{ src: pr.mediaUrl as string, mediaType: 'audio' as const, programId: pr.id, title: pr.title, partNo: 1, totalParts: 1 }] });
    }
  }
  return { items, feedsDown };
}
/** Loaded on demand (the guide response is several MB): live podcast feeds + talk radio + old-time radio. */
export async function loadSpokenItems(fetchImpl: typeof fetch = fetch): Promise<SpokenCatalog> {
  const res = await fetchImpl(`/api/schedule?guide=audio-podcasts&light=1&tz=${new Date().getTimezoneOffset()}`);
  if (!res.ok) throw new Error(`podcast list HTTP ${res.status}`);
  const data = (await res.json()) as { channels?: SpokenChannel[] };
  return buildSpokenItems(data.channels ?? []);
}


/** Round-robin by show so a list opens with many different shows, not 40 episodes of the first one. Order inside each show is kept. */
export function interleaveByShow(items: ListenItem[]): ListenItem[] {
  const byShow = new Map<string, ListenItem[]>();
  for (const it of items) { const k = it.subtitle || it.genre || it.channelId; const list = byShow.get(k); if (list) list.push(it); else byShow.set(k, [it]); }
  const lists = [...byShow.values()];
  const out: ListenItem[] = [];
  for (let i = 0; out.length < items.length; i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

/** Newest published episode first across every show (index 0 is the newest release); items with no publish date follow, taking turns by show. */
export function orderPodcasts(items: ListenItem[]): ListenItem[] {
  const dated = items.filter((i) => typeof i.publishedAt === 'number').sort((a, b) => (b.publishedAt as number) - (a.publishedAt as number));
  return [...dated, ...interleaveByShow(items.filter((i) => typeof i.publishedAt !== 'number'))];
}

export interface Freshness { today: boolean; age: string }
/** "Today" is the listener's own calendar day. `age` is a relative label such as "2 h ago", "yesterday", "4 days ago". */
export function freshness(publishedAt: number | undefined, now: number = Date.now()): Freshness | null {
  if (typeof publishedAt !== 'number' || !Number.isFinite(publishedAt)) return null;
  const d = new Date(publishedAt), n = new Date(now);
  const today = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  const mins = Math.max(0, Math.round((now - publishedAt) / 60000));
  if (mins < 60) return { today, age: `${mins} min ago` };
  if (mins < 24 * 60) return { today, age: `${Math.round(mins / 60)} h ago` };
  const midnight = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((midnight(n) - midnight(d)) / 86_400_000);
  if (days <= 1) return { today, age: 'yesterday' };
  if (days < 30) return { today, age: `${days} days ago` };
  return { today, age: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) };
}
