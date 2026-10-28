import assert from 'node:assert/strict';
import { buildMoviesClassicsPrograms, MOVIES_CLASSICS_CHANNEL_ID, MOVIES_CLASSICS_GUIDE_ID } from './src/services/producers/moviesClassicsProducer.ts';

const manifest = [
  {
    identifier: 'm-1931', title: 'M', year: 1931,
    files: [{ name: 'M.mp4', format: 'MPEG4' }],
  },
  {
    identifier: 'classic-movie-pack-vol1', title: 'Classic Movie Pack Vol 1', year: 1940,
    files: [
      { name: 'Feature One.mp4', format: 'MPEG4', title: 'Feature One' },
      { name: 'Feature Two.mp4', format: 'MPEG4', title: 'Feature Two' },
      { name: 'notes.txt', format: 'Text' },
    ],
  },
];

const programs = buildMoviesClassicsPrograms(manifest);
assert.equal(programs.length, 3);
assert.ok(programs.every((p) => p.channelId === MOVIES_CLASSICS_CHANNEL_ID));
assert.ok(programs.every((p) => p.guideId === MOVIES_CLASSICS_GUIDE_ID));
assert.ok(programs.every((p) => p.sourceClass === 'archive_org'));
assert.ok(programs.every((p) => p.sourceId?.trim() && p.assetId?.trim()));
assert.equal(new Set(programs.map((p) => p.assetId)).size, 3);
assert.ok(programs.every((p) => !p.mediaUrl.includes('BigBuckBunny')));
assert.equal(programs.filter((p) => p.archivePath.endsWith('M.mp4')).length, 1);
assert.equal(programs.filter((p) => p.archivePath.includes('Feature%20One.mp4')).length, 1);
assert.ok(programs.every((p) => p.mediaUrl.startsWith('/api/archive/proxy?path=')));
console.log('✅ Movies Classics producer structure gate: PASS');
