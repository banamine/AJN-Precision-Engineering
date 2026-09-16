import assert from 'node:assert/strict';
import {
  ARCHIVE_EPG_DEFAULT_LIMIT,
  ARCHIVE_EPG_MAX_CHANNELS,
  ARCHIVE_EPG_MAX_LIMIT,
  getArchiveChannelPage,
  getArchiveProgramPage,
} from './src/archive-epg-loader.ts';
import { CLASSIC_TV_TEST_PROGRAMS } from './src/archive-test-catalog.ts';

const channels = Array.from({ length: 5001 }, (_, index) => ({ id: `archive-${index}`, name: `Archive ${index}` }));
const first = getArchiveChannelPage(channels, 0, 100);
assert.equal(first.items.length, 100);
assert.equal(first.offset, 0);
assert.equal(first.limit, 100);
assert.equal(first.total, ARCHIVE_EPG_MAX_CHANNELS);
assert.equal(first.items[0].id, 'archive-0');
assert.equal(first.items.at(-1).id, 'archive-99');

const high = getArchiveChannelPage(channels, 4900, 100);
assert.equal(high.items.length, 100);
assert.equal(high.items[0].id, 'archive-4900');
assert.equal(high.items.at(-1).id, 'archive-4999');
assert.equal(high.hasMore, false);

const clamped = getArchiveChannelPage(channels, 0, 10000);
assert.equal(clamped.limit, ARCHIVE_EPG_MAX_LIMIT);
assert.equal(clamped.items.length, ARCHIVE_EPG_MAX_LIMIT);
assert.equal(ARCHIVE_EPG_DEFAULT_LIMIT, 50);

const programsA = getArchiveProgramPage('classic-tv-101', 0, 2);
const programsB = getArchiveProgramPage('classic-tv-101', 0, 2);
assert.deepEqual(programsA.items.map(p => p.id), programsB.items.map(p => p.id));
assert.equal(programsA.items.length, 2);
assert.equal(programsA.items[0].mediaUrl, CLASSIC_TV_TEST_PROGRAMS[0].mediaUrl);
assert.equal(programsA.items[1].mediaUrl, CLASSIC_TV_TEST_PROGRAMS[1].mediaUrl);
assert.equal(programsA.items[0].metadata?.sourceId, 'src-classic-tv-101-1');
assert.equal(programsA.items[1].metadata?.sourceId, 'src-classic-tv-101-2');

console.log('Archive EPG bounded paging: PASS');
console.log(`5000-channel cap: PASS (${first.total})`);
console.log('offset 0: PASS');
console.log('offset 4900: PASS');
console.log('bounded program window: PASS');
console.log('stable IDs and exact URLs: PASS');
