import type { ScheduleChannel } from '../src/types';

const ITEM_MUSIC_PREFIX = 'item-music-';
/** Looped Archive music-list channels (Music List 1/2 ingestion). They carry up to ~160 rows each and are trimmed like item-music. */
const MUSIC_LOOP_PREFIX = 'music-';

/** Keep only the current track and its next two daily-loop tracks for long item-music and music-* loop rows. */
export function buildAudioLightSchedule(channels: readonly ScheduleChannel[], localHour: number): ScheduleChannel[] {
  if (!Number.isFinite(localHour) || localHour < 0 || localHour >= 24) {
    throw new RangeError('localHour must be between 0 and 24');
  }

  return channels.map((channel) => {
    const programs = channel.programs ?? [];
    const isItemMusic = channel.id.startsWith(ITEM_MUSIC_PREFIX);
    const isMusicLoop = channel.id.startsWith(MUSIC_LOOP_PREFIX);
    if ((!isItemMusic && !isMusicLoop) || channel.mediaType !== 'audio' || programs.length <= 24) {
      return channel;
    }

    const currentIndex = programs.findIndex((program) => {
      const start = program.startHour ?? program.startTime;
      const end = program.endHour ?? program.endTime;
      return Number.isFinite(start) && Number.isFinite(end) && start <= localHour && localHour < end;
    });
    if (currentIndex < 0 && isItemMusic) {
      throw new RangeError(`item-music channel ${channel.id} has no row at local hour ${localHour}`);
    }
    // A music-* loop with a gap at this hour still ships only 3 rows; programsComplete:false makes the client fetch the whole channel on demand.
    const startIndex = Math.max(currentIndex, 0);

    const selected = [0, 1, 2].map((offset) => programs[(startIndex + offset) % programs.length]);
    return { ...channel, programs: selected, programCount: programs.length, programsComplete: false };
  });
}
