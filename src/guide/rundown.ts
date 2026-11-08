import { cleanAjnDisplayTitle } from "../utils/ajnTitleNormalizer";
import { localHours } from "./groupProgramsForGrid";
import { formatHour } from "./todayList";

export interface ProgramLike {
  id: string;
  title: string;
  channelId?: string;
  guideId?: string;
  startTime?: number;
  endTime?: number;
  startHour?: number;
  endHour?: number;
  startTimeUtc?: string;
  endTimeUtc?: string;
  duration?: number;
  description?: string;
  archivePath?: string;
  mediaUrl?: string;
  mediaType?: "video" | "audio";
  sourceId?: string;
  assetId?: string;
  metadata?: Record<string, unknown>;
}

export interface Entry {
  id: string;
  program: ProgramLike;
  title: string;
  startHour: number;
  endHour: number;
  start: string;
  end: string;
  durationMinutes: number;
  progress: number;
  minutesRemaining: number;
  seasonEpisode: string | null;
}

export interface RundownResult {
  past: Entry[];
  now: Entry | null;
  upcoming: Entry[];
}

function normalizeDisplayHour(hour: number): number {
  const mod = ((hour % 24) + 24) % 24;
  return mod === 0 && hour > 0 && hour % 24 === 0 ? 24 : mod;
}

/**
 * Extracts a real S##E## code ONLY when present in program metadata or title.
 * Never invents season or episode numbers (R1).
 */
export function extractSeasonEpisode(program: ProgramLike): string | null {
  const meta = program.metadata;
  if (meta) {
    if (typeof meta.seasonEpisode === "string" && /^S\d{1,2}E\d{1,3}$/i.test(meta.seasonEpisode.trim())) {
      return meta.seasonEpisode.trim().toUpperCase();
    }
    const sRaw = meta.season ?? meta.seasonNumber;
    const eRaw = meta.episode ?? meta.episodeNumber;
    const sNum = typeof sRaw === "number" ? sRaw : typeof sRaw === "string" && /^\d+$/.test(sRaw.trim()) ? Number(sRaw.trim()) : NaN;
    const eNum = typeof eRaw === "number" ? eRaw : typeof eRaw === "string" && /^\d+$/.test(eRaw.trim()) ? Number(eRaw.trim()) : NaN;
    if (Number.isInteger(sNum) && sNum > 0 && Number.isInteger(eNum) && eNum > 0) {
      return `S${String(sNum).padStart(2, "0")}E${String(eNum).padStart(2, "0")}`;
    }
  }
  const match = /\bS(\d{1,2})E(\d{1,3})\b/i.exec(program.title ?? "");
  if (match) {
    return `S${match[1].padStart(2, "0")}E${match[2].padStart(2, "0")}`;
  }
  return null;
}

function resolveProgramHours(program: ProgramLike, nowMs: number, nowHour: number): { sHour: number; eHour: number } | null {
  const meta = program.metadata;
  if (meta?.epg === "utc" && typeof program.startTimeUtc === "string" && typeof program.endTimeUtc === "string") {
    const startMs = Date.parse(program.startTimeUtc);
    const endMs = Date.parse(program.endTimeUtc);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
    const midnight = new Date(nowMs);
    midnight.setHours(0, 0, 0, 0);
    const midMs = midnight.getTime();
    const sHour = (startMs - midMs) / 3_600_000;
    const eHour = (endMs - midMs) / 3_600_000;
    // Skip UTC entries that do not touch the current local day [0, 24]
    if (eHour <= 0 || sHour >= 24) return null;
    return { sHour, eHour };
  }

  const hasExplicitStart = typeof program.startHour === "number" || typeof program.startTime === "number";
  const hasExplicitEnd = typeof program.endHour === "number" || typeof program.endTime === "number";
  if (!hasExplicitStart && !hasExplicitEnd) return null;

  const base = localHours(program as Parameters<typeof localHours>[0]);
  const rawStart = base.sHour;
  const rawEnd = base.eHour;
  if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) return null;

  // Midnight-crossing program where endHour wraps around (e.g. 23 -> 1)
  if (rawEnd < rawStart && rawStart >= 0 && rawStart < 24 && rawEnd > 0 && rawEnd <= 24) {
    if (nowHour < rawEnd) {
      return { sHour: rawStart - 24, eHour: rawEnd };
    }
    return { sHour: rawStart, eHour: rawEnd + 24 };
  }

  if (rawEnd <= rawStart) return null;
  return { sHour: rawStart, eHour: rawEnd };
}

/**
 * Splits a channel's programs into past, now, and upcoming relative to nowMs.
 * Uses the same hour fields as localHours in groupProgramsForGrid.ts.
 */
export function buildRundown(programs: readonly ProgramLike[], nowMs: number): RundownResult {
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const nowDate = new Date(safeNowMs);
  const nowHour =
    nowDate.getHours() +
    nowDate.getMinutes() / 60 +
    nowDate.getSeconds() / 3600 +
    nowDate.getMilliseconds() / 3_600_000;

  const resolved: { program: ProgramLike; sHour: number; eHour: number }[] = [];
  for (const program of programs) {
    const hrs = resolveProgramHours(program, safeNowMs, nowHour);
    if (!hrs) continue;
    resolved.push({ program, sHour: hrs.sHour, eHour: hrs.eHour });
  }

  resolved.sort((a, b) => a.sHour - b.sHour || a.eHour - b.eHour);

  const past: Entry[] = [];
  let now: Entry | null = null;
  const upcoming: Entry[] = [];

  for (const { program, sHour, eHour } of resolved) {
    const spanHours = Math.max(0, eHour - sHour);
    const durationMinutes = Math.max(1, Math.round(spanHours * 60));
    const displayStart = formatHour(normalizeDisplayHour(sHour));
    const displayEnd = formatHour(normalizeDisplayHour(eHour));
    const title = cleanAjnDisplayTitle(program.title);
    const seasonEpisode = extractSeasonEpisode(program);

    if (eHour <= nowHour) {
      past.push({
        id: program.id,
        program,
        title,
        startHour: sHour,
        endHour: eHour,
        start: displayStart,
        end: displayEnd,
        durationMinutes,
        progress: 1,
        minutesRemaining: 0,
        seasonEpisode,
      });
    } else if (sHour <= nowHour && nowHour < eHour && now === null) {
      const progress = spanHours > 0 ? Math.min(1, Math.max(0, (nowHour - sHour) / spanHours)) : 0;
      const minutesRemaining = Math.max(0, Math.ceil((eHour - nowHour) * 60));
      now = {
        id: program.id,
        program,
        title,
        startHour: sHour,
        endHour: eHour,
        start: displayStart,
        end: displayEnd,
        durationMinutes,
        progress,
        minutesRemaining,
        seasonEpisode,
      };
    } else if (sHour > nowHour) {
      upcoming.push({
        id: program.id,
        program,
        title,
        startHour: sHour,
        endHour: eHour,
        start: displayStart,
        end: displayEnd,
        durationMinutes,
        progress: 0,
        minutesRemaining: durationMinutes,
        seasonEpisode,
      });
    }
  }

  return { past, now, upcoming };
}

/**
 * Returns up to `count` upcoming entries for a channel relative to `nowMs`.
 */
export function nextUp(programs: readonly ProgramLike[], nowMs: number, count: number): Entry[] {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (safeCount === 0) return [];
  const { upcoming } = buildRundown(programs, nowMs);
  return upcoming.slice(0, safeCount);
}
