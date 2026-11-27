/* Day and daypart markers for the "Up next" list. Pure: rows in, markers out. Denver time, same hours as On Air (src/onair/dayparts.ts). */
import { daypartForHour, type Daypart } from '../onair/dayparts';

export const DENVER_TZ = 'America/Denver';
const fmt = new Intl.DateTimeFormat('en-US', { timeZone: DENVER_TZ, hour: 'numeric', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' });

export function denverParts(ms: number): { dayKey: string; hour: number } {
  const p: Record<string, string> = {};
  for (const x of fmt.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { dayKey: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}

export const DAYPART_SPAN: Record<Daypart, string> = {
  Morning: '05:00–11:59', Afternoon: '12:00–17:59', Evening: '18:00–22:59', 'Late Night': '23:00–04:59',
};

export interface RowMarker { day?: string; daypart?: Daypart }

/** For each start time (in list order): a day label when the Denver date changes (Today / Tomorrow / date) and a daypart label when the daypart changes. */
export function markRows(startsMs: readonly (number | null)[], nowMs: number): RowMarker[] {
  const today = denverParts(nowMs).dayKey;
  const tomorrow = denverParts(nowMs + 24 * 3600 * 1000).dayKey;
  let prevDay = '';
  let prevPart: Daypart | '' = '';
  return startsMs.map((ms) => {
    if (ms === null || !Number.isFinite(ms)) return {};
    const { dayKey, hour } = denverParts(ms);
    const part = daypartForHour(hour);
    const m: RowMarker = {};
    if (dayKey !== prevDay) { m.day = dayKey === today ? 'Today' : dayKey === tomorrow ? 'Tomorrow' : dayKey; prevDay = dayKey; }
    if (part !== prevPart || m.day) { if (part !== prevPart) m.daypart = part; prevPart = part; }
    return m;
  });
}
