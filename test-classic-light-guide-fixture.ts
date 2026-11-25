import type { Program, ScheduleChannel } from './src/types';

export function createClassicLightFixture(): ScheduleChannel[] {
  return Array.from({ length: 80 }, (_, index) => {
    const id = `demo-channel-${String(index + 1).padStart(3, '0')}`;
    const current: Program = {
      id: `${id}-current`,
      guideId: 'classic-tv',
      channelId: id,
      title: `DEMO — Synthetic current show ${index + 1}`,
      startTime: 0,
      endTime: 24,
      startHour: 0,
      endHour: 24,
      mediaType: 'video',
      mediaUrl: `/synthetic/${id}-current.mp4`,
      archivePath: `/synthetic/${id}-current.mp4`,
    };
    const nextOne: Program = {
      ...current,
      id: `${id}-next-one`,
      title: `DEMO — Synthetic next one ${index + 1}`,
      startTime: 24,
      endTime: 25,
      startHour: 24,
      endHour: 25,
      mediaUrl: `/synthetic/${id}-next-one.mp4`,
      archivePath: `/synthetic/${id}-next-one.mp4`,
    };
    const nextTwo: Program = {
      ...nextOne,
      id: `${id}-next-two`,
      title: `DEMO — Synthetic next two ${index + 1}`,
      startTime: 25,
      endTime: 26,
      startHour: 25,
      endHour: 26,
      mediaUrl: `/synthetic/${id}-next-two.mp4`,
      archivePath: `/synthetic/${id}-next-two.mp4`,
    };
    const hidden: Program = {
      ...nextTwo,
      id: `${id}-hidden-title`,
      title: index === 79 ? 'DEMO Hidden Program Title Candidate' : `DEMO — Older synthetic entry ${index + 1}`,
      startTime: 26,
      endTime: 27,
      startHour: 26,
      endHour: 27,
      mediaUrl: `/synthetic/${id}-hidden.mp4`,
      archivePath: `/synthetic/${id}-hidden.mp4`,
    };
    return {
      id,
      guideId: 'classic-tv',
      name: `DEMO — Synthetic Channel ${String(index + 1).padStart(3, '0')}`,
      mediaType: 'video',
      group: 'Synthetic',
      programs: [current, nextOne, nextTwo, hidden],
      programCount: 4,
      moreTitles: true,
      programsComplete: false,
    };
  });
}
