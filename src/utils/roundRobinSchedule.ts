/* 24-hour round-robin broadcast schedule engine. Pure: no React, no network, no wall clock (callers pass `utcMs`).
 * Real durations only: a pool is clock-eligible only when EVERY track has a positive duration. Nothing is estimated.
 * Clock mode: the order is seeded by the UTC calendar day + pool id, and the position is (utcMs - utcMidnight) % loop length,
 * so every listener in every timezone hears the same track at the same instant. Only label formatting is timezone-aware. */

export const DAY_MS = 86_400_000;
export type ScheduleBank = 'music' | 'concerts' | 'fm' | 'podcasts';

export interface SchedTrack {
  /** `<rawArchiveId>::<partNo>` (1-based part), no prefixes. */
  programId: string;
  archiveId: string;
  partNo: number;
  bank: ScheduleBank;
  poolId: string;
  channelId: string;
  guideId: string;
  title: string;
  subtitle: string;
  /** Archive path (/download/<id>/<file>). */
  src: string;
  /** Real seconds from the manifest/snapshot; undefined when unknown (the pool then runs Shuffle only). */
  durationSeconds?: number;
}
/** One album / concert / broadcast: its tracks in play order. */
export interface SchedItem { id: string; tracks: SchedTrack[] }
export interface SchedPool { id: string; label: string; bank: ScheduleBank; items: SchedItem[] }
export interface Slot { track: SchedTrack; startUtcMs: number; endUtcMs: number; index: number; cycle: number }

export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const hasDuration = (t: SchedTrack): boolean => typeof t.durationSeconds === 'number' && Number.isFinite(t.durationSeconds) && t.durationSeconds > 0;
export const poolTrackCount = (pool: SchedPool): number => pool.items.reduce((n, i) => n + i.tracks.length, 0);
/** Clock mode needs a real duration on every track. */
export function clockEligible(pool: SchedPool | null | undefined): boolean {
  if (!pool) return false;
  let any = false;
  for (const item of pool.items) for (const t of item.tracks) { if (!hasDuration(t)) return false; any = true; }
  return any;
}

/** One loop of the pool: item order shuffled by `seed`, then taken round-robin (track 1 of every item, track 2 of every item, ...),
 *  so consecutive slots come from different recordings whenever more than one item has tracks left. */
export function orderTracks(pool: SchedPool, seed: number): SchedTrack[] {
  const rng = mulberry32(seed);
  const items = pool.items.filter((i) => i.tracks.length > 0).slice();
  for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
  const out: SchedTrack[] = [];
  const longest = items.reduce((m, i) => Math.max(m, i.tracks.length), 0);
  for (let r = 0; r < longest; r++) for (const item of items) if (r < item.tracks.length) out.push(item.tracks[r]);
  return out;
}

interface Ordered { order: SchedTrack[]; startMs: number[]; durMs: number[]; totalMs: number }
const cache = new Map<string, Ordered>();
const seedFor = (day: number, poolId: string): number => fnv1a(`${day}:${poolId}`);
function ordered(pool: SchedPool, seed: number): Ordered | null {
  if (!clockEligible(pool)) return null;
  const key = `${pool.id}|${poolTrackCount(pool)}|${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const order = orderTracks(pool, seed);
  const startMs: number[] = []; const durMs: number[] = []; let total = 0;
  for (const t of order) { const d = Math.max(1, Math.round((t.durationSeconds as number) * 1000)); startMs.push(total); durMs.push(d); total += d; }
  const o = { order, startMs, durMs, totalMs: total };
  if (cache.size >= 8) cache.delete(cache.keys().next().value as string);
  cache.set(key, o);
  return o;
}

/** Length of one loop in seconds for `utcMs`'s UTC day (null when the pool is not clock-eligible). */
export function loopSeconds(pool: SchedPool, utcMs: number): number | null {
  const o = ordered(pool, seedFor(Math.floor(utcMs / DAY_MS), pool.id));
  return o ? o.totalMs / 1000 : null;
}

/** The slot airing at `utcMs`. A slot that would run past UTC midnight is clipped there (the next day reseeds). Null when not clock-eligible. */
export function slotAt(pool: SchedPool, utcMs: number): Slot | null {
  const day = Math.floor(utcMs / DAY_MS); const dayStart = day * DAY_MS;
  const o = ordered(pool, seedFor(day, pool.id));
  if (!o || o.totalMs <= 0) return null;
  const elapsed = utcMs - dayStart;
  const cycle = Math.floor(elapsed / o.totalMs);
  const within = elapsed - cycle * o.totalMs;
  let lo = 0, hi = o.startMs.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (o.startMs[mid] <= within) lo = mid; else hi = mid - 1; }
  const start = dayStart + cycle * o.totalMs + o.startMs[lo];
  return { track: o.order[lo], startUtcMs: start, endUtcMs: Math.min(start + o.durMs[lo], dayStart + DAY_MS), index: lo, cycle: cycle + 1 };
}
/** The `count` scheduled slots after `slot` (crossing UTC midnight reseeds). */
export function slotsAfter(pool: SchedPool, slot: Slot, count: number): Slot[] {
  const out: Slot[] = []; let t = slot.endUtcMs;
  for (let i = 0; i < count; i++) { const s = slotAt(pool, t); if (!s || s.endUtcMs <= t) break; out.push(s); t = s.endUtcMs; }
  return out;
}

/** Shuffle mode: the next `count` tracks after `index` with projected start times (null when a duration is unknown). */
export function shuffleWindow(order: readonly SchedTrack[], index: number, startedMs: number | null, count: number): { track: SchedTrack; startUtcMs: number | null }[] {
  const out: { track: SchedTrack; startUtcMs: number | null }[] = [];
  if (order.length === 0) return out;
  let at: number | null = startedMs; let prev = order[index % order.length];
  for (let i = 1; i <= count && i < order.length + 1; i++) {
    at = at !== null && hasDuration(prev) ? at + (prev.durationSeconds as number) * 1000 : null;
    const track = order[(index + i) % order.length];
    out.push({ track, startUtcMs: at }); prev = track;
  }
  return out;
}

export function formatClock(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '--:--';
  const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function formatDuration(seconds: number | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return '--:--';
  const s = Math.round(seconds); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
export function formatRepeat(totalSeconds: number): string {
  const m = Math.round(totalSeconds / 60); const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}
