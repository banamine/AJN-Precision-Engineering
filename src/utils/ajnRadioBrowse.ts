// Pure browsing helpers for the Radio view: show/type chips, sort, title search, neighbours. No I/O, no clock.
import type { RadioEntry } from './ajnRadioCatalog.ts';
import { AJN_SHOWS, type AjnShowType } from './ajnClassify.ts';

export type RadioSort = 'newest' | 'oldest';
export const UNSORTED = 'unsorted';
export interface RadioFilter { show: string | null; type: string | null; query: string; sort: RadioSort }
export interface Chip { key: string; label: string; count: number }

const SHOW_NAME: Record<string, string> = Object.fromEntries(Object.values(AJN_SHOWS).map(show => [show.slug, show.name]));
const TYPE_LABEL: Record<AjnShowType, string> = { full_show: 'Full shows', hour: 'Hours', special: 'Specials' };
const SHOW_ORDER = ['alex-jones', 'war-room', 'sunday-night-live'];
const TYPE_ORDER: string[] = ['full_show', 'hour', 'special'];

export const showKey = (entry: RadioEntry): string => entry.classified.showSlug ?? UNSORTED;
export const typeKey = (entry: RadioEntry): string => entry.classified.showType ?? UNSORTED;
export const showLabel = (key: string): string => SHOW_NAME[key] ?? 'Unsorted';
export const typeLabel = (key: string): string => TYPE_LABEL[key as AjnShowType] ?? 'Unsorted';
export function showInitials(entry: RadioEntry): string {
  switch (entry.classified.showSlug) { case 'alex-jones': return 'AJ'; case 'war-room': return 'WR'; case 'sunday-night-live': return 'SNL'; default: return 'AJN'; }
}

function chips(entries: readonly RadioEntry[], key: (e: RadioEntry) => string, label: (k: string) => string, order: string[]): Chip[] {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(key(entry), (counts.get(key(entry)) ?? 0) + 1);
  const rank = (k: string) => { const i = order.indexOf(k); return i < 0 ? order.length : i; };
  return [...counts.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0])).map(([k, count]) => ({ key: k, label: label(k), count }));
}
/** Chips are offered only when they would actually narrow the list (two or more values). */
export const showChips = (entries: readonly RadioEntry[]): Chip[] => { const c = chips(entries, showKey, showLabel, SHOW_ORDER); return c.length >= 2 ? c : []; };
export const typeChips = (entries: readonly RadioEntry[]): Chip[] => { const c = chips(entries, typeKey, typeLabel, TYPE_ORDER); return c.length >= 2 ? c : []; };

/** `entries` arrive newest first (buildRadioCatalog). Oldest-first keeps undated entries last: they are never given a guessed date. */
export function filterEntries(entries: readonly RadioEntry[], filter: RadioFilter): RadioEntry[] {
  const needle = filter.query.trim().toLowerCase();
  const kept = entries.filter(e => (!filter.show || showKey(e) === filter.show) && (!filter.type || typeKey(e) === filter.type) && (!needle || e.title.toLowerCase().includes(needle)));
  if (filter.sort === 'newest') return kept;
  const dated = kept.filter(e => e.airDate !== null).reverse();
  return [...dated, ...kept.filter(e => e.airDate === null)];
}

export const isPlayingEntry = (entry: RadioEntry, programId: string | undefined): boolean => Boolean(programId) && (programId === entry.id || programId === `${entry.id}:video`);
export function neighbour(list: readonly RadioEntry[], programId: string | undefined, direction: -1 | 1): RadioEntry | null {
  const index = list.findIndex(e => isPlayingEntry(e, programId));
  if (index < 0) return null;
  return list[index + direction] ?? null;
}
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.floor(seconds); const h = Math.floor(total / 3600); const m = Math.floor((total % 3600) / 60); const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
