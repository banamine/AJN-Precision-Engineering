import assert from 'node:assert/strict';
import type { Program, ScheduleChannel } from './src/types';
import { buildAudioLightSchedule } from './server/audioLightSchedule';
import { groupProgramsForGrid } from './src/guide/groupProgramsForGrid';

function tracks(channelId: string, count: number, lane?: string): Program[] {
  return Array.from({ length: count }, (_, index) => {
    const startHour = index * 24 / count;
    const endHour = (index + 1) * 24 / count;
    return {
      id: `${channelId}:d${index}`,
      guideId: 'audio-podcasts',
      channelId,
      title: `DEMO track ${index}`,
      startTime: startHour,
      endTime: endHour,
      startHour,
      endHour,
      mediaType: 'audio',
      mediaUrl: `/synthetic/${channelId}/${index}.mp3`,
      archivePath: `/synthetic/${channelId}/${index}.mp3`,
      metadata: lane ? { lane } : undefined,
    };
  });
}

function channel(id: string, count: number, mediaType: 'audio' | 'video' = 'audio', lane?: string): ScheduleChannel {
  return {
    id,
    guideId: 'audio-podcasts',
    name: `DEMO ${id}`,
    mediaType,
    group: 'DEMO',
    sourceStatus: 'ok',
    diagnostics: { candidateCount: 9, resolvedItems: 4 },
    programs: tracks(id, count, lane),
  };
}

const music = channel('item-music-demo', 30, 'audio', 'music');
const infowars = channel('archive-infowars-radio', 9, 'audio');
const shortMusic = channel('item-music-short', 24, 'audio', 'music');
const otherAudio = channel('long-john-nebel', 30, 'audio');
const video = channel('item-music-video', 30, 'video', 'music');

const noon = buildAudioLightSchedule([music, infowars, shortMusic, otherAudio, video], 12.5);
assert.deepEqual(noon[0].programs.map((program) => program.id), ['item-music-demo:d15', 'item-music-demo:d16', 'item-music-demo:d17']);
assert.equal(noon[0].programCount, 30);
assert.equal(noon[0].programsComplete, false);
assert.equal(groupProgramsForGrid(noon[0], 40, 12.5).mode, 'programs', 'incomplete music rows stay individually labelled until full rows arrive');
assert.equal(noon[0].name, music.name);
assert.equal(noon[0].group, music.group);
assert.equal(noon[0].mediaType, music.mediaType);
assert.equal(noon[0].sourceStatus, music.sourceStatus);
assert.deepEqual(noon[0].diagnostics, music.diagnostics);
assert.equal(noon[0].programs[0], music.programs[15], 'program objects and identities are untouched');
assert.deepEqual(Object.keys(noon[0].programs[0]).sort(), Object.keys(music.programs[15]).sort(), 'no fields are added to a program');
assert.equal(noon[1], infowars, 'INFOWARS remains whole');
assert.equal(noon[1].programs.length, 9);
assert.equal(noon[2], shortMusic, '24-row item-music channel remains whole');
assert.equal(noon[3], otherAudio, 'non-item-music audio remains whole');
assert.equal(noon[4], video, 'video channels remain whole');

const late = buildAudioLightSchedule([music], 23.5)[0];
assert.deepEqual(late.programs.map((program) => program.id), ['item-music-demo:d29', 'item-music-demo:d0', 'item-music-demo:d1'], 'daily loop wraps to the first rows');
assert.throws(() => buildAudioLightSchedule([music], 24), /localHour/);
assert.throws(() => buildAudioLightSchedule([channel('item-music-gap', 25)], 24), /localHour/);

const gap = channel('item-music-gap', 30, 'audio', 'music');
gap.programs = gap.programs.map((program) => ({ ...program, startHour: program.startHour! + 5, endHour: program.endHour! + 5 }));
assert.throws(() => buildAudioLightSchedule([gap], 1), /has no row at local hour/);
console.log('PASS audio-light-schedule: 3-row selection, wrap, identity, untouched channels, and invalid inputs');
