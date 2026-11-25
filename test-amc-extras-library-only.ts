import assert from 'node:assert/strict';
import { LIBRARY_SOURCES, libraryFromChannels } from './server/library';
import { toM3u, toXmltv, visibleScheduleChannels } from './server/channelExport';

process.env.NODE_ENV ??= 'test';
globalThis.fetch = async () => new Response(
  JSON.stringify({ files: [], response: { docs: [] } }),
  { status: 200, headers: { 'content-type': 'application/json' } },
);

const { getScheduleForGuide } = await import('./guideRegistry');
const groups = [];
for (const source of LIBRARY_SOURCES) {
  groups.push({ ...source, channels: await getScheduleForGuide(source.guideId) });
}
const classicTv = groups.find((group) => group.guideId === 'classic-tv')!.channels;
const extras = classicTv.find((channel) => channel.id === 'ajn-allmychildren-extras');
const episodes = classicTv.find((channel) => channel.id === 'ajn-allmychildren-episodes');

assert.ok(extras, 'Classic TV raw channels include All My Children extras');
assert.equal(extras.libraryOnly, true, 'extras are retained as Library-only channels');
assert.ok(extras.programs.length > 0);
assert.ok(extras.programs.every((program) => program.endTime <= program.startTime), 'extras retain their date-only time fields');
assert.ok(episodes, 'Classic TV raw channels retain the episodes channel');
assert.equal(episodes.libraryOnly, undefined, 'episodes remain a scheduled channel');
assert.ok(episodes.programs.length > 0);
assert.ok(episodes.programs.every((program) => program.endTime > program.startTime), 'episode slots have positive intervals');

const scheduleChannels = visibleScheduleChannels(classicTv);
assert.ok(!scheduleChannels.some((channel) => channel.id === extras.id), 'schedule-shaped output excludes extras');
assert.ok(scheduleChannels.some((channel) => channel.id === episodes.id), 'schedule-shaped output retains episodes');
const invalidSchedulePrograms = scheduleChannels.reduce(
  (count, channel) => count + channel.programs.filter((program) => program.endTime <= program.startTime).length,
  0,
);
assert.equal(invalidSchedulePrograms, 0, 'library-only zero-time programs are not counted in schedules');

const groupsBeforeFlag = groups.map((group) => ({
  ...group,
  channels: group.channels.map(({ libraryOnly: _libraryOnly, ...channel }) => channel),
}));
const libraryBefore = libraryFromChannels(groupsBeforeFlag);
const libraryAfter = libraryFromChannels(groups);
assert.equal(libraryAfter.length, libraryBefore.length, 'Library count is unchanged by libraryOnly');
assert.deepEqual(
  libraryAfter.map((item) => item.id).sort(),
  libraryBefore.map((item) => item.id).sort(),
  'Library item ids are unchanged by libraryOnly',
);
assert.equal(
  libraryAfter.filter((item) => item.channelId === extras.id).length,
  libraryBefore.filter((item) => item.channelId === extras.id).length,
  'AMC extras reachability in /api/library is unchanged',
);

const snapshot = {
  guideId: 'classic-tv',
  generatedAt: '2026-10-26T12:00:00.000Z',
  channels: [episodes, extras],
};
const m3u = toM3u(snapshot, null, 'https://app.example');
assert.ok(!m3u.includes(`tvg-id="${extras.id}"`), 'M3U exports exclude AMC extras');
assert.ok(m3u.includes(`tvg-id="${episodes.id}"`), 'M3U exports retain AMC episodes');
const xmltv = toXmltv(snapshot, null);
assert.ok(!xmltv.includes(`<channel id="${extras.id}">`), 'XMLTV exports exclude AMC extras');
assert.ok(xmltv.includes(`<channel id="${episodes.id}">`), 'XMLTV exports retain AMC episodes');

console.log(`PASS amc-extras-library-only | raw extras ${extras.programs.length} | Library count unchanged (${libraryAfter.length}) | scheduled episodes ${episodes.programs.length}`);
