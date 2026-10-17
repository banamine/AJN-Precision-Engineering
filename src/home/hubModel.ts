// Pure logic for the Home hub rows (no React, no network). Storage access is injected so tests need no browser.
import { dailyOrder, hash32 } from '../utils/dayRotation';

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }
const safe = <T,>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };

// ---- collapsed / open rows, remembered per viewer ----
export const ROW_STATE_KEY = 'ajn.home.rowStates.v1';
export type RowId = 'discover' | 'classic48' | 'digest' | 'reel';
export function readRowOpen(store: KV | null, id: RowId, defaultOpen: boolean): boolean {
  if (!store) return defaultOpen;
  const v = safe(() => JSON.parse(store.getItem(ROW_STATE_KEY) || '{}') as Record<string, unknown>, {});
  return typeof v[id] === 'boolean' ? (v[id] as boolean) : defaultOpen;
}
export function writeRowOpen(store: KV | null, id: RowId, open: boolean): void {
  if (!store) return;
  safe(() => { const v = JSON.parse(store.getItem(ROW_STATE_KEY) || '{}') as Record<string, unknown>; v[id] = open; store.setItem(ROW_STATE_KEY, JSON.stringify(v)); }, undefined);
}

// ---- Discover: per-visit seed, "Not interested" list ----
export const SEED_KEY = 'ajn.home.discoverSeed';
export const DISMISSED_KEY = 'ajn.home.dismissed.v1';
export const DISMISSED_MAX = 300;
/** One seed per browser session: Home remounting on Back keeps the same picks. Not Math.random: derived from the clock. */
export function sessionSeed(store: KV | null, nowMs: number, key: string = SEED_KEY): string {
  const got = store ? safe(() => store.getItem(key), null) : null;
  if (got) return got;
  const seed = String(nowMs);
  if (store) safe(() => store.setItem(key, seed), undefined);
  return seed;
}
export function nextSeed(store: KV | null, current: string, key: string = SEED_KEY): string {
  const seed = String(hash32(`${current}|shuffle|${current.length}`) % 1_000_000_007) + ':' + String((Number(current.split(':')[1] ?? 0) || 0) + 1);
  if (store) safe(() => store.setItem(key, seed), undefined);
  return seed;
}
export function readDismissed(store: KV | null): string[] {
  if (!store) return [];
  const v = safe(() => JSON.parse(store.getItem(DISMISSED_KEY) || '[]') as unknown, []);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(-DISMISSED_MAX) : [];
}
export function addDismissed(store: KV | null, key: string): string[] {
  const next = [...readDismissed(store).filter((k) => k !== key), key].slice(-DISMISSED_MAX);
  if (store) safe(() => store.setItem(DISMISSED_KEY, JSON.stringify(next)), undefined);
  return next;
}
export function clearDismissed(store: KV | null): void { if (store) safe(() => store.setItem(DISMISSED_KEY, '[]'), undefined); }

export interface DiscoverItem {
  /** Stable key: assetId, else Archive identifier/path. NEVER a program id (Classic ids carry a daily slot suffix). */
  key: string; categoryId: string; categoryLabel: string; title: string; subtitle: string;
  mediaType: 'video' | 'audio'; path: string; thumb?: string; durSeconds?: number;
  channelId: string; guideId: string; programId: string; sourceId?: string; assetId?: string;
}
export const DISCOVER_LIMIT = 10;
export const DISCOVER_PER_CATEGORY = 2;

/** Round-robin across categories (at most `perCategory` each), order from the seed, dismissed items and repeats removed. */
export function pickDiscover(pool: readonly DiscoverItem[], seed: string, dismissed: readonly string[], limit = DISCOVER_LIMIT, perCategory = DISCOVER_PER_CATEGORY): DiscoverItem[] {
  const gone = new Set(dismissed);
  const seen = new Set<string>();
  const byCat = new Map<string, DiscoverItem[]>();
  for (const it of dailyOrder(pool.filter((i) => !gone.has(i.key)), (i) => i.key, seed, 'discover')) {
    if (seen.has(it.key)) continue; seen.add(it.key);
    const list = byCat.get(it.categoryId) ?? []; if (list.length < perCategory) { list.push(it); byCat.set(it.categoryId, list); }
  }
  const cats = dailyOrder([...byCat.keys()], (c) => c, seed, 'discover-cats');
  const out: DiscoverItem[] = [];
  for (let round = 0; round < perCategory && out.length < limit; round++) {
    for (const c of cats) { const it = byCat.get(c)?.[round]; if (it && out.length < limit) out.push(it); }
  }
  return out;
}

// ---- Classic TV 48 h row ----
export interface UpcomingCard { channelId: string; channelName: string; programId: string; assetId?: string; sourceId?: string; title: string; startMs: number; endMs: number; path: string; mediaType: 'video' | 'audio' }
export type DayTab = 'today' | 'tomorrow';
export const sameLocalDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();
export function dayOf(startMs: number, nowMs: number): DayTab | 'later' {
  if (sameLocalDay(startMs, nowMs)) return 'today';
  return sameLocalDay(startMs, nowMs + 24 * 3600_000) ? 'tomorrow' : 'later';
}
/** Chronological cards for one day tab. Programs that already ended are dropped; the airing one is kept (the card says "On now"). */
export function cardsForDay(channels: ReadonlyArray<{ id: string; name: string; programs: ReadonlyArray<Omit<UpcomingCard, 'channelId' | 'channelName'>> }>, tab: DayTab, nowMs: number): UpcomingCard[] {
  const out: UpcomingCard[] = [];
  for (const c of channels) for (const p of c.programs) if (p.endMs > nowMs && dayOf(p.startMs, nowMs) === tab) out.push({ ...p, channelId: c.id, channelName: c.name });
  return out.sort((a, b) => a.startMs - b.startMs || a.channelName.localeCompare(b.channelName));
}
/** "Jump to time" targets as hours of the day. */
export const JUMP_HOURS: ReadonlyArray<{ id: string; label: string; hour: number | null }> = [
  { id: 'now', label: 'Now', hour: null }, { id: 'morning', label: 'Morning · 8 AM', hour: 8 }, { id: 'afternoon', label: 'Afternoon · 1 PM', hour: 13 },
  { id: 'evening', label: 'Evening · 7 PM', hour: 19 }, { id: 'late', label: 'Late night · 11 PM', hour: 23 },
];
/** Index of the first card that starts at or after the chosen local hour of the card's day (or the first card when none does). */
export function jumpIndex(cards: readonly UpcomingCard[], hour: number | null): number {
  if (hour === null || cards.length === 0) return 0;
  const i = cards.findIndex((c) => { const d = new Date(c.startMs); return d.getHours() + d.getMinutes() / 60 >= hour; });
  return i < 0 ? cards.length - 1 : i;
}
