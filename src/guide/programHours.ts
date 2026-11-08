export interface ProgramHourInput {
  id?: string;
  title: string;
  startTime?: number;
  endTime?: number;
  startHour?: number;
  endHour?: number;
  startTimeUtc?: string;
  endTimeUtc?: string;
  metadata?: Record<string, unknown>;
}

export function hourLabel(hour: number): string {
  const h = Math.floor(hour) % 24;
  const period = h < 12 ? "AM" : "PM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}${period}`;
}

export function currentHourFraction(): number {
  const now = new Date();
  return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
}

/**
 * Grid hours for a program. Listings timed in UTC (Live TV from Pluto) are
 * placed in the viewer's local day and clipped to it; others use their hours.
 */
export function withLocalHours<T extends ProgramHourInput>(
  program: T,
  referenceMs?: number,
): { program: T; sHour: number; eHour: number } {
  if (program.metadata?.epg === "utc" && program.startTimeUtc && program.endTimeUtc) {
    const midnight = referenceMs !== undefined ? new Date(referenceMs) : new Date();
    midnight.setHours(0, 0, 0, 0);
    const h = (iso: string) => (Date.parse(iso) - midnight.getTime()) / 3_600_000;
    return { program, sHour: Math.max(0, h(program.startTimeUtc)), eHour: Math.min(24, h(program.endTimeUtc)) };
  }
  return {
    program,
    sHour: program.startHour ?? program.startTime ?? 0,
    eHour: program.endHour ?? program.endTime ?? 24,
  };
}

/**
 * Builds a deterministic live-program key for memoized row isolation.
 * Uses program.id + startHour when id is non-empty; otherwise falls back to
 * channelId + startHour + program.title.
 */
export function buildProgramLiveKey(
  channelId: string,
  program: { id?: string; title: string },
  sHour: number,
): string {
  const rawId = typeof program.id === "string" ? program.id.trim() : "";
  if (rawId.length > 0) {
    return `${rawId}:${sHour}`;
  }
  return `${channelId}:${sHour}:${program.title}`;
}

export function buildLiveKey(
  channelId: string,
  item: { program: { id?: string; title: string }; sHour: number } | null,
): string | null {
  if (!item) return null;
  return buildProgramLiveKey(channelId, item.program, item.sHour);
}
