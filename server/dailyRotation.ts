import type { Program } from '../src/types';

const DAY_MS = 24 * 60 * 60 * 1000;
const ORIGIN_MS = Date.UTC(2026, 0, 1);

/** Movies-only UTC rotation. The cut film counts as aired; tomorrow starts
 * with its successor. Recompute from the origin, never from request history. */
export function layoutRotatingDailySchedule(
  programs: Program[], defaultMinutes: number, now: Date,
): Program[] {
  if (!Number.isFinite(now.getTime())) throw new RangeError('Invalid rotation date');
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = (day - ORIGIN_MS) / DAY_MS;
  if (days < 0) throw new RangeError('Movie rotation starts on 2026-01-01 UTC');
  if (programs.length === 0) return [];
  if (!Number.isFinite(defaultMinutes) || defaultMinutes <= 0) {
    throw new RangeError('Movie rotation default duration must be positive and finite');
  }
  const durations = programs.map(program => {
    const candidate = Number(program.metadata?.durationSeconds);
    const seconds = candidate > 0 ? candidate : defaultMinutes * 60;
    if (!Number.isFinite(seconds)) throw new RangeError('Movie duration must be finite');
    return seconds * 1000;
  });

  let startIndex = 0;
  for (let d = 0; d < days; d++) {
    let elapsed = 0;
    let index = startIndex;
    while (elapsed < DAY_MS) {
      elapsed += durations[index];
      index = (index + 1) % programs.length;
    }
    startIndex = index;
  }

  const out: Program[] = [];
  const end = day + DAY_MS;
  let time = day;
  let index = startIndex;
  while (time < end) {
    const p = programs[index];
    const stop = Math.min(time + durations[index], end);
    const hour = (ms: number) => (ms - day) / 3_600_000;
    out.push({
      ...p,
      metadata: { ...(p.metadata ?? {}), airedUtc: p.metadata?.airedUtc ?? p.startTimeUtc },
      id: `${p.id}:d${out.length}`,
      startTimeUtc: new Date(time).toISOString(),
      endTimeUtc: new Date(stop).toISOString(),
      startTime: hour(time), endTime: hour(stop),
      startHour: hour(time), endHour: hour(stop),
    });
    time = stop;
    index = (index + 1) % programs.length;
  }
  return out;
}
