/* Bounds the size of a looped music channel's schedule.
 * The guide draws a program at its startHour/endHour on the VIEWER'S LOCAL clock (EpgGuide uses startHour for
 * everything not tagged epg:'utc', and its "now" line is the local hour). A short playlist (e.g. 48 tracks, ~3 h) is
 * therefore looped across all 24 grid hours so no hour is empty, but a full day of 3-minute tracks is ~480 rows per
 * channel, which would break the 24 MiB schedule budget (test-music-schedule-budget.mjs). The guide sends its local
 * clock offset (?tz=) and gets only the rows from (local hour - behindH) to (local hour + aheadH), at most maxEntries.
 * Rows keep the ids/hours they have in the full loop, so the track at a given hour is the same on every request. */
import type { Program } from '../src/types';

export const WINDOW_BEHIND_H = 3;
export const WINDOW_AHEAD_H = 9;
export const WINDOW_MAX_ENTRIES = 160;

const hoursOf = (p: Program) => ({ s: p.startHour ?? p.startTime ?? 0, e: p.endHour ?? p.endTime ?? 24 });

export function windowByHour(programs: readonly Program[], localHour: number, behindH = WINDOW_BEHIND_H, aheadH = WINDOW_AHEAD_H, maxEntries = WINDOW_MAX_ENTRIES): Program[] {
  const from = localHour - behindH, to = localHour + aheadH;
  const out: Program[] = [];
  for (const p of programs) {
    const { s, e } = hoursOf(p);
    if (e <= from || s >= to) continue;
    out.push(p);
    if (out.length >= maxEntries) break;
  }
  return out;
}

/** Local clock hour (0 to 24) of an instant for a viewer whose JS Date#getTimezoneOffset() is tzMinutes; null for junk input. */
export function localHourAt(nowMs: number, tzMinutes: unknown): number | null {
  const m = typeof tzMinutes === 'string' ? Number(tzMinutes) : NaN;
  if (!Number.isFinite(m) || Math.abs(m) > 14 * 60 || !/^-?\d+$/.test(String(tzMinutes))) return null;
  const local = (nowMs / 60000 - m) / 60; // hours since the epoch on the viewer's wall clock
  return ((local % 24) + 24) % 24;
}
