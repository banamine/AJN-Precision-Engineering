import assert from 'node:assert/strict';
import manifest from './src/data/extraChannelsManifest.json';
import type { Program } from './src/types';
import {
  buildBalancedMovieOrder,
  layoutBalancedMovieSchedule,
  MOVIES_CLASSICS_LEGACY_CHANNEL_ID,
  resolveMoviesClassicChannelAlias,
  splitMoviesClassicsChannel,
  summarizeMovieSchedule,
} from './server/moviesClassicsSchedule';

const extra = manifest as any;
const legacy = extra.channels.find((channel: any) => channel.id === MOVIES_CLASSICS_LEGACY_CHANNEL_ID);
assert.ok(legacy, 'source manifest retains the legacy channel and all rows');
assert.equal(legacy.rows.length, 4_053);
const partitions = splitMoviesClassicsChannel(legacy);
assert.equal(partitions.length, 20);
assert.deepEqual(partitions.map((partition) => partition.rows.length), [
  81, 83, 130, 169, 243, 200, 200, 244, 244, 204, 204, 205, 247, 247, 225, 225, 225, 225, 226, 226,
]);
assert.ok(partitions.every((partition, index) =>
  partition.id === `mx-movies-classics-${String(index + 1).padStart(2, '0')}`
  && partition.group === legacy.group
  && partition.guideId === legacy.guideId
  && partition.rows.length >= 60
  && partition.rows.length <= 250,
));
const sourceIds = legacy.rows.map((row: any) => row.id);
const partitionIds = partitions.flatMap((partition) => partition.rows.map((row) => row.id));
assert.deepEqual([...partitionIds].sort(), [...sourceIds].sort(), 'every source row appears exactly once');
assert.equal(new Set(partitionIds).size, sourceIds.length);
assert.equal(new Set(partitions.flatMap((partition) => partition.rows.map((row) => `${row.identifier}/${row.file}`))).size, sourceIds.length);
assert.equal(partitions[0].name, 'Movies Classics · Pre-1940');
assert.equal(partitions[5].name, 'Movies Classics · 1980s · Part 1 of 2');
assert.equal(partitions.at(-1)!.name, 'Movies Classics · Unknown year · Part 6 of 6');
assert.equal(resolveMoviesClassicChannelAlias(MOVIES_CLASSICS_LEGACY_CHANNEL_ID), 'mx-movies-classics-01');

const row = (id: string, title: string, year?: number) => ({
  id,
  identifier: `test-${id}`,
  file: `${id}.mp4`,
  title: year ? `${title} (${year})` : title,
  bytes: 100,
  durationSeconds: 1_800,
  thumb: null,
});
const smallDecade = {
  guideId: 'movies-classics-vault',
  id: MOVIES_CLASSICS_LEGACY_CHANNEL_ID,
  name: 'Movies Classics',
  group: 'Movies',
  rows: [
    ...Array.from({ length: 10 }, (_, index) => row(`old-${index}`, `Old ${index}`, 1930)),
    ...Array.from({ length: 100 }, (_, index) => row(`forties-${index}`, `Forty ${index}`, 1940)),
  ],
};
const merged = splitMoviesClassicsChannel(smallDecade);
assert.equal(merged.length, 1, 'undersized decade merges to nearest populated decade');
assert.equal(merged[0].rows.length, 110);
assert.ok(merged[0].name.includes('1940s'));
assert.throws(() => splitMoviesClassicsChannel({ ...smallDecade, rows: smallDecade.rows.slice(0, 50) }), /no merge target/);

const makeProgram = (index: number, identifier: string, title: string, durationSeconds = 7_200): Program => ({
  id: `movie-${String(index).padStart(3, '0')}`,
  guideId: 'movies-classics-vault',
  channelId: 'mx-movies-classics-01',
  title,
  mediaType: 'video',
  mediaUrl: `/download/${identifier}/file-${index}.mp4`,
  archivePath: `/download/${identifier}/file-${index}.mp4`,
  sourceId: `source-${identifier}`,
  assetId: `asset-${index}`,
  startTime: 0,
  endTime: 0,
  metadata: { archiveIdentifier: identifier, durationSeconds },
} as Program);
const distributed = Array.from({ length: 32 }, (_, index) =>
  makeProgram(index, `id-${index % 4}`, `Unique title ${String(index).padStart(2, '0')}`),
);
const original = JSON.stringify(distributed);
const order = buildBalancedMovieOrder(distributed);
assert.equal(order.length, 32);
assert.deepEqual(order.slice(0, 4).map((program) => program.metadata?.archiveIdentifier), ['id-0', 'id-1', 'id-2', 'id-3']);
assert.equal(new Set(order.map((program) => program.archivePath)).size, 32);
assert.equal(JSON.stringify(distributed), original, 'rotation does not mutate source programs');

const repeatedTitle = [
  ...Array.from({ length: 11 }, (_, index) =>
    makeProgram(index, `title-id-${String(index).padStart(2, '0')}`, `Title ${String.fromCharCode(65 + index)}`)),
  makeProgram(11, 'title-id-11', 'Title B'),
];
const relaxedOrder = buildBalancedMovieOrder(repeatedTitle);
assert.equal(relaxedOrder.length, 12, 'all distinct source files are retained');
assert.ok(relaxedOrder.some((program) => program.metadata?.rotationWindowRelaxed === true),
  'least-recent-title fallback is explicitly counted when every unseen item is in the title window');
for (let index = 1; index < relaxedOrder.length; index++) {
  assert.notEqual(relaxedOrder[index - 1].archivePath, relaxedOrder[index].archivePath);
}

const smallTitleSet = [
  makeProgram(20, 'small-window', 'Small title A'),
  makeProgram(21, 'small-window', 'Small title B'),
  makeProgram(22, 'small-window', 'Small title C'),
  makeProgram(23, 'small-window', 'Small title A'),
  makeProgram(24, 'small-window', 'Small title B'),
  makeProgram(25, 'small-window', 'Small title C'),
];
const smallTitleOrder = buildBalancedMovieOrder(smallTitleSet);
assert.deepEqual(smallTitleOrder.map((program) => program.title), [
  'Small title A',
  'Small title B',
  'Small title C',
  'Small title A',
  'Small title B',
  'Small title C',
]);
for (let index = 0; index < smallTitleOrder.length; index++) {
  for (let previous = Math.max(0, index - 2); previous < index; previous++) {
    if (smallTitleOrder[index].title === smallTitleOrder[previous].title) {
      assert.equal(smallTitleOrder[index].metadata?.rotationWindowRelaxed, true,
        'three-title channels keep a two-slot window unless explicitly relaxed');
    }
  }
}
assert.equal(smallTitleOrder.length, smallTitleSet.length);

const now = new Date('2026-10-31T12:00:00Z');
const threeDays = [0, 1, 2].map((offset) =>
  layoutBalancedMovieSchedule(distributed, 100, new Date(now.getTime() + offset * 86_400_000)),
);
assert.deepEqual(threeDays.map((schedule) => schedule.length), [12, 12, 12]);
for (const [dayIndex, schedule] of threeDays.entries()) {
  assert.equal(Date.parse(schedule[0].startTimeUtc!), Date.UTC(2026, 9, 31 + dayIndex));
  for (let index = 1; index < schedule.length; index++) {
    assert.notEqual(schedule[index - 1].archivePath, schedule[index].archivePath);
  }
}
const threeDaySequence = threeDays.flat();
for (let index = 1; index < threeDaySequence.length; index++) {
  assert.notEqual(threeDaySequence[index - 1].archivePath, threeDaySequence[index].archivePath,
    'daily rotation does not repeat a file across a UTC midnight boundary');
}
assert.notEqual(threeDays[0][0].assetId, threeDays[1][0].assetId, 'date-injected daily rotation advances');
assert.equal(summarizeMovieSchedule(threeDays[0], 20).identifierShareSoftCap, 0.1);
assert.equal(summarizeMovieSchedule(relaxedOrder).windowRelaxed, 2,
  'count both the forced fallback slot and the unavoidable cyclic wrap slot');

const singleton = layoutBalancedMovieSchedule(
  [makeProgram(99, 'only-id', 'Only film', 1_800)],
  100,
  new Date('2026-01-01T12:00:00Z'),
);
assert.equal(singleton.length, 1, 'a one-file channel is not looped to fill the day');
assert.equal(singleton[0].endHour, 0.5);
assert.equal(summarizeMovieSchedule(singleton).longestIdenticalTitleRun, 1);
assert.equal(
  layoutBalancedMovieSchedule(
    [makeProgram(99, 'only-id', 'Only film', 1_800)],
    100,
    new Date('2026-01-02T12:00:00Z'),
  ).length,
  0,
  'a one-file channel does not repeat on the next day',
);

console.log('movies channel split: PASS (20 partitions, 4,053 rows preserved, round-robin/title-window, 3-day clock injection, singleton, legacy alias)');
