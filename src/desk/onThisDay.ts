/* Which Desk stories go first in the On Air "On This Day" panel: stories whose document date falls within a few days of today's
 * month and day (any year) come first, nearest first; every other story follows, in the order it was given. Pure. */
import type { DeskItem } from '../../server/desk';

export const DATE_WINDOW_DAYS = 3;
const DAY = 86_400_000;

/** Days between two month/day pairs, ignoring the year (wraps around the new year). */
export function monthDayDistance(aMonth: number, aDay: number, bMonth: number, bDay: number): number {
  const at = (m: number, d: number, y: number) => Date.UTC(y, m - 1, d);
  const a = at(aMonth, aDay, 2001);
  let best = Infinity;
  for (const y of [2000, 2001, 2002]) best = Math.min(best, Math.abs(a - at(bMonth, bDay, y)) / DAY);
  return Math.round(best);
}

export interface RankedStory { item: DeskItem; exact: boolean; near: boolean; distance: number | null }

/** `today` is a Denver month/day. Story cards only (a lead is required). */
export function rankForToday(items: DeskItem[], today: { month: number; day: number }): RankedStory[] {
  const stories = items.filter((i) => i.cardType === 'story' && i.lead);
  const ranked = stories.map((item, idx) => {
    const m = item.docDate?.match(/^\d{4}-(\d{2})-(\d{2})$/);
    const distance = m ? monthDayDistance(Number(m[1]), Number(m[2]), today.month, today.day) : null;
    return { item, idx, distance };
  });
  const within = ranked.filter((r) => r.distance !== null && r.distance <= DATE_WINDOW_DAYS).sort((a, b) => (a.distance! - b.distance!) || (a.idx - b.idx));
  const rest = ranked.filter((r) => !(r.distance !== null && r.distance <= DATE_WINDOW_DAYS)).sort((a, b) => a.idx - b.idx);
  return [...within, ...rest].map((r) => ({ item: r.item, exact: r.distance === 0, near: r.distance !== null && r.distance <= DATE_WINDOW_DAYS, distance: r.distance }));
}

/** The label under a story: says plainly how it relates to today. Nothing is claimed that the document date does not support. */
export function dateLine(r: RankedStory, year: number | null): string {
  if (r.exact) return `On this day${year ? ` in ${year}` : ''}`;
  if (r.near && r.distance !== null) return `This week${year ? ` in ${year}` : ''}`;
  return year ? `From ${year}` : 'Date unknown';
}
