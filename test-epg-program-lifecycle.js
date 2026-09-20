import { upsertCanonicalProgram, getCanonicalProgram, getCanonicalPrograms, sweepCanonicalPrograms } from './guideRegistry.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const now = Date.now();
const makeProgram = (externalId, endTime, title = externalId) => ({
  id: `placeholder-${externalId}`,
  guideId: 'cable-tv',
  channelId: 'test-channel',
  title,
  description: 'Lifecycle regression',
  startTime: new Date(endTime - 60 * 60 * 1000).toISOString(),
  endTime: typeof endTime === 'string' ? Date.parse(endTime) : endTime,
  startTimeUtc: new Date(new Date(endTime).getTime() - 60 * 60 * 1000).toISOString(),
  endTimeUtc: new Date(endTime).toISOString(),
  mediaType: 'video',
  mediaUrl: '/download/test.mp4',
  archivePath: '/download/test.mp4',
  sourceClass: 'archive_org',
  isArchivedSource: true,
  metadata: { externalId },
});

console.log('Canonical program lifecycle regression: starting');

const initial = makeProgram('lifecycle-1', new Date(now + 60 * 60 * 1000).toISOString(), 'Initial Title');
const stored = upsertCanonicalProgram(initial);
assert(stored.id.startsWith('program-'), 'upsertCanonicalProgram must derive the canonical program identity');
assert(getCanonicalProgram(stored.id)?.title === 'Initial Title', 'Inserted program must be readable');

const updated = { ...initial, title: 'Updated Title', metadata: { externalId: 'lifecycle-1' } };
const updatedStored = upsertCanonicalProgram(updated);
assert(updatedStored.id === stored.id, 'Same external identity must preserve the canonical program ID');
assert(getCanonicalPrograms().filter((program) => program.id === stored.id).length === 1, 'Upsert must not create duplicate canonical programs');
assert(getCanonicalProgram(stored.id)?.title === 'Updated Title', 'Upsert must replace the canonical record');

const oldId = upsertCanonicalProgram(
  makeProgram('lifecycle-old', new Date(now - (24 * 60 * 60 * 1000) - 1000).toISOString(), 'Expired Program'),
).id;
assert(getCanonicalProgram(oldId) === undefined, 'Expired program must be evicted during upsert sweep');

const retainedId = upsertCanonicalProgram(
  makeProgram('lifecycle-retained', new Date(now - (24 * 60 * 60 * 1000) + 60 * 1000).toISOString(), 'Retained Program'),
).id;
assert(getCanonicalProgram(retainedId)?.title === 'Retained Program', 'Program inside the 24-hour retention window must remain');

const future = upsertCanonicalProgram(
  makeProgram('lifecycle-future', new Date(now + 6 * 60 * 60 * 1000).toISOString(), 'Future Program'),
);
assert(getCanonicalProgram(future.id)?.title === 'Future Program', 'Future program must remain');

const deleted = sweepCanonicalPrograms(now);
assert(deleted >= 0, 'Explicit sweep must return a non-negative eviction count');

console.log('Canonical program lifecycle regression: PASS');

const m3uLike = {
  ...makeProgram('lifecycle-m3u-hours', new Date(now + 60 * 60 * 1000).toISOString(), 'M3U Live'),
  startTime: 0,
  endTime: 24,
  startTimeUtc: new Date(now).toISOString(),
  endTimeUtc: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
  sourceClass: 'm3u_live',
};
const m3uId = upsertCanonicalProgram(m3uLike).id;
assert(getCanonicalProgram(m3uId)?.endTime === 24, 'M3U schedule-hour fields must remain intact');
assert(getCanonicalProgram(m3uId)?.endTimeUtc === m3uLike.endTimeUtc, 'M3U UTC lifecycle field must be retained');
