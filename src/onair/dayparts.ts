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
export const isEveningHour = (hour: number): boolean => daypartForHour(hour) === 'Evening';
