export type SkyPhase = 'dawn' | 'day' | 'dusk' | 'night';
export type SkyChoice = 'auto' | SkyPhase;

/** Sky mapping (separate from shelf dayparts): dawn 05:00-09:59, day 10:00-16:59, dusk 17:00-21:29, night 21:30-04:59. */
export function skyForMinutes(minutesSinceMidnight: number): SkyPhase {
  const m = ((Math.floor(minutesSinceMidnight) % 1440) + 1440) % 1440;
  if (m >= 5 * 60 && m < 10 * 60) return 'dawn';
  if (m >= 10 * 60 && m < 17 * 60) return 'day';
  if (m >= 17 * 60 && m < 21 * 60 + 30) return 'dusk';
  return 'night';
}

export function skyForDate(date: Date): SkyPhase {
  return skyForMinutes(date.getHours() * 60 + date.getMinutes());
}
