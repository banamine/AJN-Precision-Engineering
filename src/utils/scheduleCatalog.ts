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

interface SpokenProg { id: string; title: string; mediaUrl?: string; metadata?: { durationSeconds?: number; durationEstimated?: boolean; airedUtc?: string; backCatalog?: boolean } }
interface SpokenCh { id: string; name: string; group?: string; programs?: SpokenProg[] }
const SPOKEN_POOL_GROUPS: { group: string; id: string; label: string }[] = [
  { group: 'Podcast', id: 'spoken-all-podcasts', label: 'All podcasts' },
  { group: 'Talk Radio', id: 'spoken-all-talk', label: 'All talk radio' },
  { group: 'Old-Time Radio', id: 'spoken-all-otr', label: 'All old-time radio' },
];
const DAY_MS = 86_400_000;
const MAX_MERGED_TRACKS = 600; // the newest 600 across all shows; older ones drop off the end
const pubOf = (p: SpokenProg): number | null => { const t = p.metadata?.backCatalog ? NaN : Date.parse(p.metadata?.airedUtc ?? ''); return Number.isFinite(t) && t > Date.UTC(2000, 0, 1) ? t : null; };
/** One show's episodes: dated ones newest first, then undated (Archive back-catalog) in their original order. */
export function freshFirst<T extends SpokenProg>(list: readonly T[]): T[] {
  const dated = list.filter((p) => pubOf(p) !== null).sort((a, b) => (pubOf(b) as number) - (pubOf(a) as number));
  return [...dated, ...list.filter((p) => pubOf(p) === null)];
}
/** Many shows at once: today's episodes from every show first, then yesterday's, and so on (UTC days). Inside a day the shows take turns,
 *  newest first. Undated episodes come last, shows taking turns. Pure and deterministic, so every listener gets the same order. */
export function freshFirstAcross<T extends SpokenProg>(perShow: readonly (readonly T[])[]): T[] {
  const dated: { p: T; t: number; show: number }[] = []; const undated: T[][] = perShow.map(() => []);
  perShow.forEach((list, show) => list.forEach((p) => { const t = pubOf(p); if (t === null) undated[show].push(p); else dated.push({ p, t, show }); }));
  const days = [...new Set(dated.map((d) => Math.floor(d.t / DAY_MS)))].sort((a, b) => b - a);
  const out: T[] = [];
  for (const day of days) {
    const lanes = new Map<number, T[]>();
    for (const d of dated.filter((x) => Math.floor(x.t / DAY_MS) === day).sort((a, b) => b.t - a.t)) (lanes.get(d.show) ?? lanes.set(d.show, []).get(d.show)!).push(d.p);
    const order = [...lanes.keys()].sort((a, b) => a - b); let more = true;
    for (let r = 0; more; r++) { more = false; for (const k of order) { const v = lanes.get(k)![r]; if (v) { out.push(v); more = true; } } }
  }
  for (let r = 0, more = true; more; r++) { more = false; for (const l of undated) if (l[r]) { out.push(l[r]); more = true; } }
  return out;
}
/** Pure: podcast / talk-radio / old-time-radio pools from the server's Audio & Podcasts guide.
 *  Only episodes with a REAL duration (feed or Archive metadata, never the server's 45-minute placeholder) and a media URL are scheduled;
 *  each show is one item (episodes in the server's order), so round-robin mixes shows. Pools: one per group, then one per show. */
export function buildSpokenPools(channels: readonly SpokenCh[]): SchedPool[] {
  const shows: { group: string; item: SchedItem; label: string; poolId: string; progs: SpokenProg[]; name: string; chId: string }[] = [];
  for (const ch of channels) {
    if (!ch.group || !SPOKEN_POOL_GROUPS.some((g) => g.group === ch.group)) continue;
    const seen = new Set<string>();
    const progs = freshFirst((ch.programs ?? []).filter((p) => {
      const d = p.metadata?.durationSeconds;
      if (!p.mediaUrl || !p.title || seen.has(p.mediaUrl) || p.metadata?.durationEstimated || !(typeof d === 'number' && d > 0)) return false;
      seen.add(p.mediaUrl); return true;
    })).slice(0, MAX_TRACKS);
    if (!progs.length) continue;
    const poolId = `spoken-${ch.id}`;
    const tracks: SchedTrack[] = progs.map((p, i) => ({ programId: p.id, archiveId: p.id, partNo: i + 1, bank: 'podcasts', poolId, channelId: ch.id, guideId: 'audio-podcasts',
      title: p.title, subtitle: ch.name, src: p.mediaUrl as string, durationSeconds: realDuration(p.metadata?.durationSeconds) }));
    shows.push({ group: ch.group, item: { id: ch.id, tracks }, label: ch.name, poolId, progs, name: ch.name, chId: ch.id });
  }
  const out: SchedPool[] = [];
  for (const g of SPOKEN_POOL_GROUPS) {
    const inGroup = shows.filter((s) => s.group === g.group);
    if (!inGroup.length) continue;
    if (g.group === 'Podcast') {
      // All podcasts: one fresh-first line (today's episodes from every show, then yesterday's ...), so the clock never airs a day-old episode before a newer one.
      const owner = new Map<SpokenProg, typeof inGroup[number]>();
      inGroup.forEach((s) => s.progs.forEach((p) => owner.set(p, s)));
      const merged = freshFirstAcross(inGroup.map((s) => s.progs)).slice(0, MAX_MERGED_TRACKS);
      const tracks: SchedTrack[] = merged.map((p, i) => { const o = owner.get(p)!; return { programId: p.id, archiveId: p.id, partNo: i + 1, bank: 'podcasts' as const, poolId: g.id, channelId: o.chId, guideId: 'audio-podcasts',
        title: p.title, subtitle: o.name, src: p.mediaUrl as string, durationSeconds: realDuration(p.metadata?.durationSeconds) }; });
      out.push({ id: g.id, label: g.label, bank: 'podcasts', items: [{ id: g.id, tracks }] });
    } else out.push({ id: g.id, label: g.label, bank: 'podcasts', items: inGroup.map((s) => s.item) });
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
