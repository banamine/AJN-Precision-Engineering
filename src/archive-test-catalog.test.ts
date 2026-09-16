import assert from 'node:assert/strict';
import {
  CLASSIC_TV_TEST_CHANNEL,
  CLASSIC_TV_TEST_PROGRAMS,
  CLASSIC_TV_TEST_SOURCES,
} from './archive-test-catalog';

assert.equal(CLASSIC_TV_TEST_CHANNEL.id, 'classic-tv-101');
assert.equal(CLASSIC_TV_TEST_CHANNEL.guideId, 'cable-tv');
assert.equal(CLASSIC_TV_TEST_CHANNEL.group, 'TV Classics');
assert.equal(CLASSIC_TV_TEST_PROGRAMS.length, 3);
assert.equal(CLASSIC_TV_TEST_SOURCES.length, 3);

const expectedItemIds = ['the_incredible_hulk_vhs', 'thriller_1973_1976', 'space_1999_s01e01'];
for (let i = 0; i < 3; i += 1) {
  const program = CLASSIC_TV_TEST_PROGRAMS[i];
  const source = CLASSIC_TV_TEST_SOURCES[i];
  assert.equal(program.channelId, CLASSIC_TV_TEST_CHANNEL.id);
  assert.equal(source.channelId, CLASSIC_TV_TEST_CHANNEL.id);
  assert.equal(source.url, program.mediaUrl);
  assert.equal(source.protocol, 'direct_archive');
  assert.equal(program.metadata?.archiveListId, '4');
  assert.equal(program.metadata?.archiveListSlug, 'tv-classics');
  assert.equal(program.metadata?.archiveItemId, expectedItemIds[i]);
  assert.equal(program.metadata?.sourceId, source.id);
  assert.ok(program.title.length > 0);
}

for (let i = 0; i < CLASSIC_TV_TEST_PROGRAMS.length - 1; i += 1) {
  assert.equal(CLASSIC_TV_TEST_PROGRAMS[i].endTime, CLASSIC_TV_TEST_PROGRAMS[i + 1].startTime);
}
