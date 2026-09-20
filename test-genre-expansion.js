import assert from 'node:assert/strict';
import { expandGenreCandidates } from './src/services/genreExpansion.ts';

console.log('Genre expansion utility regression: starting');

const result = expandGenreCandidates([
  {
    origin: 'user', evidenceType: 'manifest', sourceUrl: 'https://archive.org/download/demo/', identifier: 'demo',
    archiveIdentifier: 'demo', title: 'Demo Collection', channelExternalId: 'demo-channel',
    guideId: 'demo-guide', mediaType: 'video', sourceClass: 'archive_org',
    files: [
      { name: 'video.mp4', format: 'MPEG4' },
      { name: 'cover.jpg', format: 'JPEG' },
      { name: 'part2.mp4', format: 'MPEG4' },
    ], retrievedAt: '2026-09-20T00:00:00Z',
  },
  {
    origin: 'discovery', evidenceType: 'search-result', sourceUrl: 'https://archive.org/download/demo/', identifier: 'demo',
    archiveIdentifier: 'demo', title: 'Demo Collection', channelExternalId: 'demo-channel',
    guideId: 'demo-guide', mediaType: 'video', sourceClass: 'archive_org',
    files: [{ name: 'video.mp4', format: 'MPEG4' }],
  },
]);

assert.equal(result.programs.length, 2, 'two playable files should become two canonical programs');
assert.equal(result.rejected.length, 0, 'valid evidence should not be rejected');
assert.equal(result.conflicts.length, 1, 'repeated evidence should be reported as a duplicate');
assert.equal(result.conflicts[0].kind, 'duplicate');
assert.equal(new Set(result.programs.map((program) => program.assetId)).size, 2, 'each playable representation needs a unique asset');
assert.ok(result.programs.every((program) => program.sourceId?.startsWith('source-')));
assert.ok(result.programs.every((program) => program.metadata?.origin === 'user'));

const rejected = expandGenreCandidates([{
  origin: 'discovery', evidenceType: 'search-result', sourceUrl: 'not-a-url', title: 'Bad',
  guideId: 'bad-guide', mediaType: 'video', sourceClass: 'archive_org', mediaUrl: 'https://example.test/a.mp4',
}]);
assert.equal(rejected.programs.length, 0);
assert.equal(rejected.rejected[0].reason, 'valid sourceUrl is required');

console.log('Genre expansion utility regression: PASS');
