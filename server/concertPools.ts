/* Live-concert pools for the Audio & Podcasts guide.
 *
 * Data: src/data/concertPoolsManifest.json, written by tools/build-concert-library.py (source @paris-portland, ~1.3k concerts).
 * One CHANNEL per genre pool ("Live Concerts: Rock", ..., "Live Concerts: Unclassified"), never one per concert: the pool count is fixed
 * by the genre map, so station numbers (alphabetical over the whole guide, src/guide/channelIndex.ts) and the DOM stay stable.
 * No Archive calls at runtime: every track is baked, so a cold server fills these channels with zero requests; a missing/empty pool
 * yields NO channel (never a stand-in). Track titles carry the concert ("Highwire — Gin Blossoms Pittsburgh PA 1996") and the
 * structured fields (concertId/concertTitle/concertDate/trackNo) travel in metadata so nothing needs to parse the display string.
 *
 * Rotation (deterministic, same for every viewer, stable all UTC day): concerts keep their tracks together; the pool's base order is a
 * fixed hash order (not alphabetical), and each UTC day starts `perDay` concerts further along, where perDay = the fewest concerts that can fill 24 h (see concertsPerDay).
 * So a pool cycles through ALL of its concerts over ~n/perDay days (overlaps possible, gaps not) instead of replaying the same first concerts. */
import type { Program } from '../src/types';

export interface ConcertTrack { f: string; t: string; d: number; b?: number; n: number }
export interface Concert { id: string; title: string; date: string; art: string | null; thumb: string | null; tracks: ConcertTrack[] }
export interface ConcertPool { id: string; name: string; group: string; genre: string; concerts: Concert[] }
export interface ConcertPoolManifest { schema: string; source: string; pools: ConcertPool[] }
export interface ConcertPoolTask { id: string; name: string; group: string; mins: number; maxSlots: number; loopDay: boolean; build: () => Promise<Program[]> }

/** Same cap the existing "Music" item channels use (guide rows per channel; the full day stays available through the loop window). */
export const CONCERT_MAX_SLOTS = 48;
/** Audio kept per build: a full UTC day plus margin, so layoutMusicDailySchedule never starves. */
export const CONCERT_WINDOW_HOURS = 26;

const DAY_MS = 86_400_000;
const segs = (path: string) => path.split('/').map(encodeURIComponent).join('/');
/** FNV-1a: stable string -> uint32 (base order only; no Math.random anywhere). */
function fnv(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

export function concertSeconds(c: Concert): number { return c.tracks.reduce((n, t) => n + (t.d > 0 ? t.d : 0), 0); }

/** Fixed per-pool order: hash of pool id + concert id, ties by id. Independent of manifest order. */
export function baseOrder(pool: ConcertPool): Concert[] {
  return pool.concerts.map((c) => ({ c, k: fnv(`${pool.id}:${c.id}`) }))
    .sort((a, b) => a.k - b.k || (a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0)).map((x) => x.c);
}

/** Daily step = the FEWEST concerts that can fill 24 h (the longest ones first). A day always consumes at least that many concerts,
 *  so the next day starting `step` further along can never skip one: variable lengths cause small overlaps (a concert may air on two
 *  consecutive days), never gaps. */
export function concertsPerDay(pool: ConcertPool): number {
  const secs = pool.concerts.map(concertSeconds).filter((s) => s > 0).sort((a, b) => b - a);
  let acc = 0, k = 0;
  for (const s of secs) { acc += s; k++; if (acc >= 86_400) return k; }
  return Math.max(1, k); // whole pool is shorter than a day: it simply loops
}

/** The day's concert lineup: starts at (epochDay * perDay) mod n in base order and runs, wrapping, until >= windowHours of audio. */
export function lineupForDay(pool: ConcertPool, now: Date, windowHours = CONCERT_WINDOW_HOURS): Concert[] {
  const order = baseOrder(pool).filter((c) => c.tracks.length > 0);
  if (!order.length) return [];
  const epochDay = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / DAY_MS);
  const start = (epochDay * concertsPerDay(pool)) % order.length;
  const out: Concert[] = []; let secs = 0;
  for (let i = 0; i < order.length && secs < windowHours * 3600; i++) { const c = order[(start + i) % order.length]; out.push(c); secs += concertSeconds(c); }
  return out;
}

export function concertTrackPrograms(pool: ConcertPool, guideId: string, now = new Date(), windowHours = CONCERT_WINDOW_HOURS): Program[] {
  const programs: Program[] = [];
  for (const c of lineupForDay(pool, now, windowHours)) {
    const total = c.tracks.length;
    const dl = (name: string) => `/download/${encodeURIComponent(c.id)}/${segs(name)}`;
    const art = c.art ? dl(c.art) : null, thumb = c.thumb ? dl(c.thumb) : null;
    for (const t of c.tracks) {
      if (!(t.d > 0)) continue; // never invent a duration
      const archivePath = dl(t.f);
      programs.push({
        id: `${pool.id}-${c.id}-${t.n}`, guideId, channelId: pool.id, title: `${t.t} — ${c.title}`,
        description: `${c.title}${c.date ? ` (${c.date})` : ''} · track ${t.n} of ${total}`,
        startTime: 0, endTime: 0, mediaType: 'audio', mediaUrl: archivePath, archivePath, sourceClass: 'archive_org', isArchivedSource: true,
        ...(thumb ? { thumbnailUrl: thumb } : {}),
        metadata: { durationSeconds: Math.round(t.d), durationSource: 'metadata', file: t.f, lane: 'music', pool: pool.id,
          concertId: c.id, concertTitle: c.title, concertDate: c.date, trackNo: t.n, trackTitle: t.t, artPath: art, thumbPath: thumb,
          ...(typeof t.b === 'number' ? { bytes: t.b } : {}) },
      } as unknown as Program);
    }
  }
  return programs;
}

/** AudioTask-shaped entries for guideRegistry.audioTasks(). Empty/missing pools produce no task (explicit absence, not a placeholder channel). */
export function concertPoolTasks(manifest: ConcertPoolManifest | null | undefined, guideId: string, now = new Date()): ConcertPoolTask[] {
  return (manifest?.pools ?? []).filter((p) => p.concerts?.some((c) => c.tracks?.length)).map((pool) => ({
    id: pool.id, name: pool.name, group: pool.group, mins: 30, maxSlots: CONCERT_MAX_SLOTS, loopDay: true,
    build: async () => concertTrackPrograms(pool, guideId, now),
  }));
}
