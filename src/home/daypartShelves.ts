/* Pure logic for the Home daypart shelves (Dusk skin). Shelf windows are the SHELF mapping, separate from the sky mapping:
 * Morning 05:00-11:59, Afternoon 12:00-16:59, Primetime 17:00-22:59, Late Night 23:00-04:59.
 * Built only from the real schedule. No React, no network, no random values. */
import type { Program, ScheduleChannel } from '../types';
import { localHours } from '../guide/groupProgramsForGrid';

export type DaypartId = 'morning' | 'afternoon' | 'primetime' | 'latenight';
export interface Daypart { id: DaypartId; label: string; range: string; from: number; to: number }
export const DAYPARTS: readonly Daypart[] = [
  { id: 'morning', label: 'Morning', range: '5:00 AM to 11:59 AM', from: 5, to: 12 },
  { id: 'afternoon', label: 'Afternoon', range: '12:00 PM to 4:59 PM', from: 12, to: 17 },
  { id: 'primetime', label: 'Primetime', range: '5:00 PM to 10:59 PM', from: 17, to: 23 },
  { id: 'latenight', label: 'Late Night', range: '11:00 PM to 4:59 AM', from: 23, to: 5 },
];

export function inDaypart(hour: number, dp: Daypart): boolean {
  return dp.from < dp.to ? hour >= dp.from && hour < dp.to : hour >= dp.from || hour < dp.to;
}
export function daypartOfHour(hour: number): DaypartId {
  const h = ((hour % 24) + 24) % 24;
  return (DAYPARTS.find((d) => inDaypart(h, d)) ?? DAYPARTS[0]).id;
}

export type ItemStatus = 'on-air' | 'aired' | 'upcoming';
export interface ShelfItem { key: string; channel: ScheduleChannel; program: Program; sHour: number; eHour: number; status: ItemStatus }
export interface Shelf { id: DaypartId; label: string; range: string; isNow: boolean; items: ShelfItem[] }

export const SHELF_LIMIT = 12;

/** Four shelves, the one matching `nowHour` first. Each shelf lists, per video channel, its earliest programme starting in the window, ordered by start time. */
export function buildShelves(channels: readonly ScheduleChannel[], nowHour: number, nowMs: number = Date.now(), limit: number = SHELF_LIMIT): Shelf[] {
  const nowId = daypartOfHour(nowHour);
  const shelves: Shelf[] = DAYPARTS.map((dp) => {
    const items: ShelfItem[] = [];
    for (const channel of channels) {
      if (channel.libraryOnly) continue;
      let best: ShelfItem | null = null;
      for (const program of channel.programs) {
        if ((program.mediaType || channel.mediaType) === 'audio') continue;
        const { sHour, eHour } = localHours(program, nowMs);
        if (!(eHour > sHour) || sHour >= 24 || !inDaypart(sHour, dp)) continue;
        if (!best || sHour < best.sHour) {
          const status: ItemStatus = nowHour >= sHour && nowHour < eHour ? 'on-air' : eHour <= nowHour ? 'aired' : 'upcoming';
          best = { key: `${channel.guideId}:${channel.id}:${program.id}`, channel, program, sHour, eHour, status };
        }
      }
      if (best) items.push(best);
    }
    items.sort((a, b) => a.sHour - b.sHour || a.channel.name.localeCompare(b.channel.name));
    return { id: dp.id, label: dp.label, range: dp.range, isNow: dp.id === nowId, items: items.slice(0, limit) };
  });
  return [...shelves.filter((s) => s.isNow), ...shelves.filter((s) => !s.isNow)];
}

/** Which scroll arrows are usable. A 2 px tolerance absorbs sub-pixel scroll positions. */
export function edgesOf(scrollLeft: number, clientWidth: number, scrollWidth: number, tol = 2): { atStart: boolean; atEnd: boolean } {
  return { atStart: scrollLeft <= tol, atEnd: scrollLeft + clientWidth >= scrollWidth - tol };
}
