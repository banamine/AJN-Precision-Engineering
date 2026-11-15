import type { Program, ScheduleChannel } from './src/types';

export interface AudioGuideFixture {
  channels: ScheduleChannel[];
  localHour: number;
  playingProgramId: string;
}

function makePrograms(channelId: string, count: number): Program[] {
  return Array.from({ length: count }, (_, index) => {
    const startHour = index * 24 / count;
    const endHour = (index + 1) * 24 / count;
    return {
      id: `DEMO-${channelId}-${index}`,
      guideId: 'audio-podcasts',
      channelId,
      title: `DEMO synthetic program ${index + 1}`,
      description: 'DEMO synthetic description',
      startTime: startHour,
      endTime: endHour,
      startHour,
      endHour,
      mediaType: 'audio',
      mediaUrl: `/synthetic/${channelId}/${index}.mp3`,
      archivePath: `/synthetic/${channelId}/${index}.mp3`,
      metadata: channelId.startsWith('item-music-') ? { lane: 'music' } : undefined,
    };
  });
}

function makeChannel(id: string, name: string, count: number): ScheduleChannel {
  return {
    id,
    guideId: 'audio-podcasts',
    name,
    mediaType: 'audio',
    group: 'DEMO synthetic audio',
    sourceStatus: 'snapshot',
    programs: makePrograms(id, count),
  };
}

export function createAudioLightFixture(nowMs = Date.now()): AudioGuideFixture {
  const localHour = (new Date(nowMs).getHours() + new Date(nowMs).getMinutes() / 60 + new Date(nowMs).getSeconds() / 3600);
  const channels = [
    makeChannel('item-music-00s-radio-hits-2024', 'DEMO music loop', 30),
    makeChannel('archive-infowars-radio', 'DEMO radio special', 9),
    makeChannel('item-music-demo-error', 'DEMO retry fixture', 30),
  ];
  const current = channels[0].programs.find((program) => program.startHour! <= localHour && localHour < program.endHour!);
  if (!current) throw new Error(`Synthetic schedule has no current row at ${localHour}`);
  return { channels, localHour, playingProgramId: current.id };
}
