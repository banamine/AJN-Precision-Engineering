import type { ScheduleChannel } from '../src/types';

const ITEM_MUSIC_PREFIX = 'item-music-';

/** Keep only the current track and its next two daily-loop tracks for long item-music rows. */
export function buildAudioLightSchedule(channels: readonly ScheduleChannel[], localHour: number): ScheduleChannel[] {
  if (!Number.isFinite(localHour) || localHour < 0 || localHour >= 24) {
    throw new RangeError('localHour must be between 0 and 24');
  }

  return channels.map((channel) => {
    const programs = channel.programs ?? [];
    if (!channel.id.startsWith(ITEM_MUSIC_PREFIX) || channel.mediaType !== 'audio' || programs.length <= 24) {
      return channel;
    }

    const currentIndex = programs.findIndex((program) => {
      const start = program.startHour ?? program.startTime;
      const end = program.endHour ?? program.endTime;
      return Number.isFinite(start) && Number.isFinite(end) && start <= localHour && localHour < end;
    });
    if (currentIndex < 0) {
      throw new RangeError(`item-music channel ${channel.id} has no row at local hour ${localHour}`);
    }

    const selected = [0, 1, 2].map((offset) => programs[(currentIndex + offset) % programs.length]);
    return { ...channel, programs: selected, programCount: programs.length, programsComplete: false };
  });
}
