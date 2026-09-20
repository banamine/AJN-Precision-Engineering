import assert from 'node:assert/strict';
import moviesClassicsManifest from './src/data/moviesClassicsManifest.json' with { type: 'json' };
import { buildMoviesClassicsPrograms, MOVIES_CLASSICS_CHANNEL_ID, MOVIES_CLASSICS_GUIDE_ID } from './src/services/producers/moviesClassicsProducer.ts';
import { getCanonicalPrograms, getAllGuides, getScheduleForGuide } from './guideRegistry.ts';
import { getCuratedLibraryProjection } from './src/services/libraryService.ts';

const programs = buildMoviesClassicsPrograms(moviesClassicsManifest);
const expectedPrograms = moviesClassicsManifest.reduce((sum, item) => sum + item.mediaCount, 0);

assert.equal(moviesClassicsManifest.length, 29, 'Bounded manifest must contain the verified 29 extracted items');
assert.equal(expectedPrograms, 34, 'Bounded manifest must expand to 34 playable Programs');
assert.equal(programs.length, expectedPrograms, 'Producer output must match manifest mediaCount total');
assert.ok(programs.every((program) => program.channelId === MOVIES_CLASSICS_CHANNEL_ID));
assert.ok(programs.every((program) => program.guideId === MOVIES_CLASSICS_GUIDE_ID));
assert.ok(programs.every((program) => program.sourceClass === 'archive_org'));
assert.ok(programs.every((program) => program.sourceId?.trim() && program.assetId?.trim()));
assert.equal(new Set(programs.map((program) => program.assetId)).size, programs.length, 'Asset identities must be unique');
assert.ok(programs.every((program) => !program.mediaUrl.includes('BigBuckBunny')));

const wormwood = programs.filter((program) => program.sourceId === programs.find((p) => p.mediaUrl.includes('wormwood_frank-olson'))?.sourceId);
assert.equal(wormwood.length, 6, 'Wormwood multi-file item must expand to six Programs sharing one parent source identity');
assert.equal(new Set(wormwood.map((program) => program.assetId)).size, 6, 'Wormwood files must have six distinct assets');

assert.ok(getAllGuides().some((guide) => guide.id === MOVIES_CLASSICS_GUIDE_ID), 'Movies Classics guide must be registered');

const schedule = await getScheduleForGuide(MOVIES_CLASSICS_GUIDE_ID);
assert.equal(schedule.length, 1, 'Movies Classics schedule must expose one curated channel');
assert.equal(schedule[0].id, MOVIES_CLASSICS_CHANNEL_ID);
assert.equal(schedule[0].guideId, MOVIES_CLASSICS_GUIDE_ID);
assert.equal(schedule[0].programs.length, 34, 'Movies Classics schedule must expose all 34 bounded Programs');
assert.ok(schedule[0].programs.every((program) => program.sourceClass === 'archive_org'));

const canonicalMovies = getCanonicalPrograms().filter((program) => program.channelId === MOVIES_CLASSICS_CHANNEL_ID);
assert.equal(canonicalMovies.length, 34, 'Registry must hydrate all 34 bounded Movies Classics Programs');

const libraryMovies = getCuratedLibraryProjection().filter((item) => item.channelId === MOVIES_CLASSICS_CHANNEL_ID);
assert.equal(libraryMovies.length, 34, 'Library must project all 34 bounded Movies Classics Programs');
assert.ok(libraryMovies.every((item) => item.sourceClass === 'archive_org'));
assert.ok(libraryMovies.every((item) => item.sourceId && item.assetId && item.programId));

console.log('✅ Movies Classics manifest integration: PASS (29 items → 34 Programs)');
