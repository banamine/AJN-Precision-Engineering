import type { Program, ScheduleChannel } from '../src/types';
import { localHourAt } from './scheduleWindow';

const HOUR_MS = 3_600_000;

export interface ClassicLightChannel extends Omit<ScheduleChannel, 'programs'> {
  programs: Program[];
  programCount: number;
  moreTitles: boolean;
  hasCurrentProgram?: boolean;
  playlistName?: string;
  programsComplete: false;
}

export interface ClassicLightSchedule {
  guideId: 'classic-tv';
  generatedAt: string;
  light: true;
  channels: ClassicLightChannel[];
}

function localHours(program: Program, nowMs: number, tzMinutes: number): { start: number; end: number } {
  if (program.metadata?.epg === 'utc' && program.startTimeUtc && program.endTimeUtc) {
    const localNow = new Date(nowMs - tzMinutes * 60_000);
    const localMidnight = Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate()) + tzMinutes * 60_000;
    return {
      start: (Date.parse(program.startTimeUtc) - localMidnight) / HOUR_MS,
      end: (Date.parse(program.endTimeUtc) - localMidnight) / HOUR_MS,
    };
  }
  return {
    start: program.startHour ?? program.startTime,
    end: program.endHour ?? program.endTime,
  };
}

export function selectNowAndNext(programs: readonly Program[], nowHour: number, nowMs: number, tzMinutes: number): Program[] {
  const ordered = programs
    .map((program, index) => ({ program, index, ...localHours(program, nowMs, tzMinutes) }))
    .filter(({ start, end }) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .sort((a, b) => a.start - b.start || a.index - b.index);
  if (ordered.length === 0) return [];

  const currentIndex = ordered.findIndex(({ start, end }) => start <= nowHour && nowHour < end);
  const nextIndex = currentIndex >= 0
    ? currentIndex
    : ordered.findIndex(({ start }) => start >= nowHour);
  if (nextIndex < 0) return [];
  return ordered.slice(nextIndex, nextIndex + 3).map(({ program }) => program);
}

export function buildClassicLightSchedule(
  channels: readonly ScheduleChannel[],
  nowMs: number,
  tzRaw: unknown,
): ClassicLightSchedule {
  const tzMinutes = typeof tzRaw === 'string' && /^-?\d+$/.test(tzRaw) ? Number(tzRaw) : NaN;
  const nowHour = localHourAt(nowMs, String(tzRaw));
  if (nowHour === null || !Number.isFinite(tzMinutes)) {
    throw new RangeError('tz must be Date#getTimezoneOffset() in minutes');
  }

  return {
    guideId: 'classic-tv',
    generatedAt: new Date(nowMs).toISOString(),
    light: true,
    channels: channels.map((channel): ClassicLightChannel => {
      const programs = channel.programs ?? [];
      const selected = selectNowAndNext(programs, nowHour, nowMs, tzMinutes);
      const deferEpisodeRows = channel.deferLightRows === true;
      const hasCurrentProgram = deferEpisodeRows && programs.some((program) => {
        const { start, end } = localHours(program, nowMs, tzMinutes);
        return Number.isFinite(start) && Number.isFinite(end) && start <= nowHour && nowHour < end;
      });
      const playlistNameValue = programs
        .map((program) => program.metadata?.playlistName)
        .find((value): value is string => typeof value === 'string' && value.length > 0);
      return {
        id: channel.id,
        guideId: channel.guideId,
        name: channel.name,
        mediaType: channel.mediaType,
        ...(channel.group !== undefined ? { group: channel.group } : {}),
        ...(channel.logo !== undefined ? { logo: channel.logo } : {}),
        ...(channel.sourceStatus !== undefined ? { sourceStatus: channel.sourceStatus } : {}),
        ...(channel.sourceError !== undefined ? { sourceError: channel.sourceError } : {}),
        ...(playlistNameValue !== undefined ? { playlistName: playlistNameValue } : {}),
        // The Infobattalion channels are discoverable in the main guide, but
        // their episode rows load only after a user asks for that channel.
        programs: deferEpisodeRows ? [] : selected,
        programCount: programs.length,
        moreTitles: programs.length > (deferEpisodeRows ? 0 : selected.length),
        ...(deferEpisodeRows ? { hasCurrentProgram } : {}),
        programsComplete: false,
      };
    }),
  };
}
