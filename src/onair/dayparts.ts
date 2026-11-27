/* One definition of the day's parts (Denver local hours), shared by the planner, the header label and the schedule panels.
 * The engine (engine.js, plain JS) repeats these numbers in daypartOf; dayparts.test.ts keeps the two identical. */
export type Daypart = 'Morning' | 'Afternoon' | 'Evening' | 'Late Night';
export const MORNING_START_HOUR = 5;
export const AFTERNOON_START_HOUR = 12;
/** 6 pm Denver: from here the current Alex Jones shows are played; before it the archive plays. */
export const EVENING_START_HOUR = 18;
export const LATE_NIGHT_START_HOUR = 23;

export function daypartForHour(hour: number): Daypart {
  if (hour >= MORNING_START_HOUR && hour < AFTERNOON_START_HOUR) return 'Morning';
  if (hour >= AFTERNOON_START_HOUR && hour < EVENING_START_HOUR) return 'Afternoon';
  if (hour >= EVENING_START_HOUR && hour < LATE_NIGHT_START_HOUR) return 'Evening';
  return 'Late Night';
}

/* Output level per daypart, as a 0–25 dial position (see utils/volumeScale.ts). The listener's own volume stays the master:
 * this is a TRIM relative to the regular level (15), never a boost. Late night is a quieter bed; 5 (≈ −19 dB under regular) is the floor of that range. */
import { DIAL_REGULAR, gainFromDial } from '../utils/volumeScale';
export const DAYPART_DIAL: Record<Daypart, number> = { Morning: 15, Afternoon: 15, Evening: 15, 'Late Night': 7.5 };
export const daypartTrim = (dp: Daypart): number => Math.min(1, gainFromDial(DAYPART_DIAL[dp]) / gainFromDial(DIAL_REGULAR));
/** Equal-power shape for a crossfade level (0..1): rising deck sin, falling deck cos — together constant power, no mid-fade dip. */
export const equalPowerLevel = (f: number): number => (f <= 0 || f >= 1 || !Number.isFinite(f) ? Math.max(0, Math.min(1, Number.isFinite(f) ? f : 0)) : Math.sin(f * Math.PI / 2));

export const isEveningHour = (hour: number): boolean => daypartForHour(hour) === 'Evening';
