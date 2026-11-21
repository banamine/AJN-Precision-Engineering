import assert from 'node:assert/strict';
import { buildClassicLightSchedule, selectNowAndNext } from './server/classicLightSchedule';
import { searchClassicProgramTitles } from './server/classicScheduleSearch';
import { ALL_CATEGORIES, buildSearchIndex, filterChannels, numberChannels } from './src/guide/channelIndex';
import type { Program, ScheduleChannel } from './src/types';

const nowMs = Date.parse('2026-10-18T10:30:00.000Z');
const makeProgram = (id: string, startHour: number, endHour: number, title = id): Program => ({
  id,
  guideId: 'classic-tv',
  channelId: 'fixture-channel',
  title,
  startTime: startHour,
  endTime: endHour,
  startHour,
  endHour,
  mediaType: 'video',
  mediaUrl: `/synthetic/${id}.mp4`,
  archivePath: `/synthetic/${id}.mp4`,
  metadata: { playlistName: 'Synthetic local fixture' },
});

const programs = [
  makeProgram('before', 8, 9, 'Synthetic before'),
  makeProgram('current', 10, 11, 'Synthetic current'),
  makeProgram('next-1', 11, 12, 'Synthetic next one'),
  makeProgram('next-2', 12, 13, 'Synthetic next two'),
  makeProgram('later', 13, 14, 'Synthetic later'),
  makeProgram('hidden-title', 14, 15, 'Hidden outside light rows'),
];
const channel: ScheduleChannel = {
  id: 'fixture-channel',
  guideId: 'classic-tv',
  name: 'Synthetic channel',
  mediaType: 'video',
  group: 'Fixture',
  programs,
  sourceStatus: 'snapshot',
};
const emptyChannel: ScheduleChannel = {
  id: 'fixture-empty',
  guideId: 'classic-tv',
  name: 'Synthetic restricted channel',
  mediaType: 'video',
  group: 'Fixture',
  programs: [],
  sourceStatus: 'restricted',
  sourceError: 'Synthetic restriction state',
};
const deferredChannel: ScheduleChannel = { ...channel, id: 'cx-fixture', deferLightRows: true };
const prefixOnlyChannel: ScheduleChannel = { ...channel, id: 'cx-existing-with-default-light-window' };

const selected = selectNowAndNext(programs, 10.5, nowMs, 0);
assert.deepEqual(selected.map((program) => program.id), ['current', 'next-1', 'next-2']);
assert.equal(selectNowAndNext(programs, 16, nowMs, 0).length, 0, 'no invented future rows when the schedule is exhausted');

const light = buildClassicLightSchedule([channel, emptyChannel], nowMs, '0');
assert.equal(light.light, true);
assert.equal(light.channels.length, 2);
const first = light.channels[0];
assert.deepEqual(first.programs.map((program) => program.id), ['current', 'next-1', 'next-2']);
assert.equal(first.programCount, 6);
assert.equal(first.moreTitles, true);
assert.equal('titles' in first, false, 'light payload uses on-demand server-side title search');
assert.equal(first.playlistName, 'Synthetic local fixture');
assert.equal(first.programsComplete, false);
assert.deepEqual(light.channels[1].programs, []);
assert.equal(light.channels[1].sourceStatus, 'restricted');
const deferred = buildClassicLightSchedule([deferredChannel], nowMs, '0').channels[0];
assert.deepEqual(deferred.programs, [], 'Infobattalion episode rows are omitted from the main light payload');
assert.equal(deferred.programCount, 6, 'the UI can show the number of programs available on demand');
assert.equal(deferred.hasCurrentProgram, true, 'On now and one-click play retain current-program knowledge');
assert.equal(deferred.programsComplete, false);
assert.deepEqual(buildClassicLightSchedule([prefixOnlyChannel], nowMs, '0').channels[0].programs.map((program) => program.id), ['current', 'next-1', 'next-2'], 'channel IDs alone do not alter existing light-row behavior');
assert.equal(Buffer.byteLength(JSON.stringify(light)) < 2 * 1024 * 1024, true);
assert.throws(() => buildClassicLightSchedule([channel], nowMs, undefined), /tz must be Date#getTimezoneOffset/);
const titleSearch = searchClassicProgramTitles([channel], 'synthetic hidden');
assert.deepEqual(titleSearch, [{ channelId: channel.id, titles: ['Hidden outside light rows'] }]);
const lightChannel = { ...first, ...channel, programs: first.programs };
const titleIndex = buildSearchIndex(numberChannels([lightChannel]), new Map([[channel.id, titleSearch[0].titles]]));
const mixedSearch = filterChannels(numberChannels([lightChannel]), titleIndex, 'synthetic hidden', ALL_CATEGORIES);
assert.equal(mixedSearch.rows.length, 1, 'server title evidence preserves query terms split between channel name and hidden title');
assert.equal(mixedSearch.matchedShow.has(channel.id), false, 'mixed channel/title matches do not invent a single title hit');

console.log('PASS classic-light-schedule: now+next2, deferred episodes, title index, empty/restricted rows, timezone validation, 2 MiB budget');
