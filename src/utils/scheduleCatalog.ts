/* Adapts the shipped data files into schedule pools. Every track key is `<rawArchiveId>::<partNo>` (1-based, same numbering as listenCatalog),
 * and durations are the real ones from the manifest/snapshot: nothing is estimated. Missing duration stays undefined (pool = Shuffle only). */
import archiveAudioChannels from '../data/archiveAudioChannels.json';
import audioItemSnapshot from '../data/audioItemSnapshot.json';
import type { SchedItem, SchedPool, SchedTrack } from './roundRobinSchedule.ts';

const MAX_TRACKS = 300; // same cap as listenCatalog so part numbers match what the deck plays
const AUDIO_EXT = /\.(mp3|ogg|m4a|flac|wav|opus)$/i;
const segs = (path: string): string => path.split('/').map(encodeURIComponent).join('/');
const dl = (item: string, file: string): string => `/download/${encodeURIComponent(item)}/${segs(file)}`;
const baseName = (file: string): string => file.split('/').pop()!.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/^\d+\s*[.\-)]\s*/, '').trim() || file;
const realDuration = (d: unknown): number | undefined => (typeof d === 'number' && Number.isFinite(d) && d > 0 ? d : undefined);
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

interface AudioChannel { id: string; name: string; group: string; itemId: string }
interface SnapFile { file: string; durationSeconds?: number }

/** One pool per Archive Music channel (an album/collection). */
export function buildMusicPools(): SchedPool[] {
  const snap = (audioItemSnapshot as unknown as { items: Record<string, { files?: SnapFile[] }> }).items;
  const pools: SchedPool[] = [];
  for (const ch of archiveAudioChannels as AudioChannel[]) {
    if (ch.group !== 'Music') continue;
    const files = (snap[ch.itemId]?.files ?? []).filter((f) => AUDIO_EXT.test(f.file)).slice(0, MAX_TRACKS);
    if (!files.length) continue;
    const tracks: SchedTrack[] = files.map((f, i) => ({ programId: `${ch.itemId}::${i + 1}`, archiveId: ch.itemId, partNo: i + 1, bank: 'music', poolId: ch.id, channelId: ch.id, guideId: 'audio-podcasts',
      title: baseName(f.file), subtitle: ch.name, src: dl(ch.itemId, f.file), durationSeconds: realDuration(f.durationSeconds) }));
    pools.push({ id: ch.id, label: ch.name, bank: 'music', items: [{ id: ch.itemId, tracks }] });
  }
  return pools.sort((a, b) => a.label.localeCompare(b.label));
}

interface ManifestTrack { f: string; t?: string; d?: number }
interface ManifestConcert { id: string; title: string; date?: string; tracks?: ManifestTrack[] }
interface ManifestPool { id: string; genre: string; concerts: ManifestConcert[] }
function concertItem(c: ManifestConcert, poolId: string, channelId: string, genre: string): SchedItem | null {
  const files = (c.tracks ?? []).slice(0, MAX_TRACKS);
  if (!files.length) return null;
  const year = c.date ? c.date.slice(0, 4) : '';
  const subtitle = `${c.title}${year ? ` · ${year}` : ''}`;
  return { id: c.id, tracks: files.map((t, i) => ({ programId: `${c.id}::${i + 1}`, archiveId: c.id, partNo: i + 1, bank: 'concerts' as const, poolId, channelId, guideId: 'audio-podcasts',
    title: t.t || baseName(t.f), subtitle: `${genre} · ${subtitle}`, src: dl(c.id, t.f), durationSeconds: realDuration(t.d) })) };
}
/** "All live concerts" plus one pool per genre. Loaded on demand (the manifest is 1.6 MB). */
export async function loadConcertPools(): Promise<SchedPool[]> {
  const mod = await import('../data/concertPoolsManifest.json');
  const manifest = (mod.default as unknown as { pools: ManifestPool[] }).pools;
  const genres: SchedPool[] = []; const all: SchedItem[] = [];
  for (const p of manifest) {
    const channelId = `concert-pool-${slug(p.genre)}`;
    const items = p.concerts.map((c) => concertItem(c, p.id, channelId, p.genre)).filter((x): x is SchedItem => x !== null);
    if (items.length) genres.push({ id: p.id, label: p.genre, bank: 'concerts', items });
    all.push(...items);
  }
  return [{ id: 'concerts-all', label: 'All live concerts', bank: 'concerts', items: all }, ...genres.sort((a, b) => a.label.localeCompare(b.label))];
}

interface FmBroadcast { id: string; title: string; date?: string; tracks?: ManifestTrack[] }
/** The FM Broadcasts pool (src/data/fmBroadcastChannels.json). */
export async function loadFmPools(): Promise<SchedPool[]> {
  const mod = await import('../data/fmBroadcastChannels.json');
  const rows = (mod.default as unknown as { broadcasts: FmBroadcast[] }).broadcasts;
  const items = rows.map((b) => concertItem(b, 'fm-broadcasts', 'fm-broadcasts', 'FM Broadcast')).filter((x): x is SchedItem => x !== null)
    .map((it) => ({ ...it, tracks: it.tracks.map((t) => ({ ...t, bank: 'fm' as const })) }));
  return items.length ? [{ id: 'fm-broadcasts', label: 'FM Broadcasts', bank: 'fm', items }] : [];
}

interface SpokenProg { id: string; title: string; mediaUrl?: string; metadata?: { durationSeconds?: number; durationEstimated?: boolean } }
interface SpokenCh { id: string; name: string; group?: string; programs?: SpokenProg[] }
const SPOKEN_POOL_GROUPS: { group: string; id: string; label: string }[] = [
  { group: 'Podcast', id: 'spoken-all-podcasts', label: 'All podcasts' },
  { group: 'Talk Radio', id: 'spoken-all-talk', label: 'All talk radio' },
  { group: 'Old-Time Radio', id: 'spoken-all-otr', label: 'All old-time radio' },
];
/** Pure: podcast / talk-radio / old-time-radio pools from the server's Audio & Podcasts guide.
 *  Only episodes with a REAL duration (feed or Archive metadata, never the server's 45-minute placeholder) and a media URL are scheduled;
 *  each show is one item (episodes in the server's order), so round-robin mixes shows. Pools: one per group, then one per show. */
export function buildSpokenPools(channels: readonly SpokenCh[]): SchedPool[] {
  const shows: { group: string; item: SchedItem; label: string; poolId: string }[] = [];
  for (const ch of channels) {
    if (!ch.group || !SPOKEN_POOL_GROUPS.some((g) => g.group === ch.group)) continue;
    const seen = new Set<string>();
    const progs = (ch.programs ?? []).filter((p) => {
      const d = p.metadata?.durationSeconds;
      if (!p.mediaUrl || !p.title || seen.has(p.mediaUrl) || p.metadata?.durationEstimated || !(typeof d === 'number' && d > 0)) return false;
      seen.add(p.mediaUrl); return true;
    }).slice(0, MAX_TRACKS);
    if (!progs.length) continue;
    const poolId = `spoken-${ch.id}`;
    const tracks: SchedTrack[] = progs.map((p, i) => ({ programId: p.id, archiveId: p.id, partNo: i + 1, bank: 'podcasts', poolId, channelId: ch.id, guideId: 'audio-podcasts',
      title: p.title, subtitle: ch.name, src: p.mediaUrl as string, durationSeconds: realDuration(p.metadata?.durationSeconds) }));
    shows.push({ group: ch.group, item: { id: ch.id, tracks }, label: ch.name, poolId });
  }
  const out: SchedPool[] = [];
  for (const g of SPOKEN_POOL_GROUPS) {
    const items = shows.filter((s) => s.group === g.group).map((s) => s.item);
    if (items.length) out.push({ id: g.id, label: g.label, bank: 'podcasts', items });
  }
  return [...out, ...shows.sort((a, b) => a.label.localeCompare(b.label)).map((s) => ({ id: s.poolId, label: s.label, bank: 'podcasts' as const, items: [s.item] }))];
}
/** Loaded on demand (the guide response is several MB). */
export async function loadPodcastPools(fetchImpl: typeof fetch = fetch): Promise<SchedPool[]> {
  const res = await fetchImpl(`/api/schedule?guide=audio-podcasts&light=1&tz=${new Date().getTimezoneOffset()}`);
  if (!res.ok) throw new Error(`podcast list HTTP ${res.status}`);
  const data = (await res.json()) as { channels?: SpokenCh[] };
  return buildSpokenPools(data.channels ?? []);
}
