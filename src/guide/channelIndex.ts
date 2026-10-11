/* Pure helpers for the EPG channel list: alphabetical order, sequential station numbers, categories, search.
 * No React, no DOM, no network. EpgGuide calls these once per schedule load / filter change. */
import type { ScheduleChannel } from '../types';

export interface NumberedChannel { channel: ScheduleChannel; station: number }
export interface CategoryCount { id: string; label: string; count: number }
export const ALL_CATEGORIES = 'all';

/** Lowercase, accent-free, whitespace-collapsed. */
export function fold(s: string): string {
  return String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Sort key: leading article dropped so "The Odd Couple" files under O. */
function sortKey(name: string): string {
  const f = fold(name).replace(/^(the|a|an)\s+(?=\S)/, '');
  return f || fold(name);
}
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Alphabetical by display name (numbers compare numerically: "Channel 2" < "Channel 10"); id breaks ties so order is deterministic. */
export function sortChannelsAlpha(channels: readonly ScheduleChannel[]): ScheduleChannel[] {
  return [...channels].sort((a, b) => collator.compare(sortKey(a.name), sortKey(b.name)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Sequential station numbers 1..N over the WHOLE guide in alphabetical order. Filtering/searching never renumbers:
 *  a station keeps its number the way a cable lineup does. (Numbers shift only when channels are added or removed.) */
export function numberChannels(channels: readonly ScheduleChannel[]): NumberedChannel[] {
  return sortChannelsAlpha(channels).map((channel, i) => ({ channel, station: i + 1 }));
}

/** Category = the channel's group when it has one, else Video / Audio. */
export function categoryOf(c: ScheduleChannel): { id: string; label: string } {
  const label = (c.group ?? '').trim() || (c.mediaType === 'audio' ? 'Audio' : 'Video');
  return { id: fold(label), label };
}

/** Categories present in the list, biggest first (ties alphabetical). */
export function categoryCounts(list: readonly NumberedChannel[]): CategoryCount[] {
  const m = new Map<string, CategoryCount>();
  for (const { channel } of list) {
    const c = categoryOf(channel);
    const e = m.get(c.id);
    if (e) e.count++; else m.set(c.id, { id: c.id, label: c.label, count: 1 });
  }
  return [...m.values()].sort((a, b) => b.count - a.count || collator.compare(a.label, b.label));
}

export interface SearchIndexEntry { station: number; hay: string; titles: string[] }
export type SearchIndex = Map<string, SearchIndexEntry>;

/** One folded haystack per channel (name, group, station number, and every program title), built once per schedule load. */
export function buildSearchIndex(list: readonly NumberedChannel[]): SearchIndex {
  const idx: SearchIndex = new Map();
  for (const { channel, station } of list) {
    const titles: string[] = [];
    const seen = new Set<string>();
    for (const p of channel.programs ?? []) {
      const t = fold(p.title);
      if (t && !seen.has(t)) { seen.add(t); titles.push(t); }
    }
    idx.set(channel.id, { station, hay: `${fold(channel.name)} ${fold(channel.group ?? '')} ${station} ${titles.join(' | ')}`, titles });
  }
  return idx;
}

export interface FilterResult { rows: NumberedChannel[]; /** channel id -> first program title that matched (when the match was a show, not the channel) */ matchedShow: Map<string, string> }

/** Every whitespace-separated term must match (AND). A bare number also matches the station number exactly ("12"). */
export function filterChannels(list: readonly NumberedChannel[], index: SearchIndex, query: string, category: string): FilterResult {
  const terms = fold(query).split(' ').filter(Boolean);
  const matchedShow = new Map<string, string>();
  const rows = list.filter(({ channel, station }) => {
    if (category !== ALL_CATEGORIES && categoryOf(channel).id !== category) return false;
    if (!terms.length) return true;
    const e = index.get(channel.id);
    if (!e) return false;
    if (!terms.every((t) => e.hay.includes(t))) return false;
    const nameHay = `${fold(channel.name)} ${fold(channel.group ?? '')} ${station}`;
    if (!terms.every((t) => nameHay.includes(t))) {
      const hit = (channel.programs ?? []).find((p) => { const ft = fold(p.title); return terms.every((t) => ft.includes(t)); });
      if (hit) matchedShow.set(channel.id, hit.title);
    }
    return true;
  });
  return { rows, matchedShow };
}

export const stationLabel = (n: number): string => String(n).padStart(3, '0');
