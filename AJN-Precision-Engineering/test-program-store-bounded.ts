// Regression: repeated /api/schedule calls must not grow the canonical program store.
import assert from 'node:assert/strict';
import { getScheduleForGuide, getCanonicalPrograms } from './guideRegistry.ts';

for (const guide of ['audio-podcasts', 'science-documentaries', 'movies-classics-vault']) {
  await getScheduleForGuide(guide);
  const before = getCanonicalPrograms().length;
  for (let i = 0; i < 200; i++) await getScheduleForGuide(guide);
  const after = getCanonicalPrograms().length;
  assert.equal(after, before, `${guide}: program store grew from ${before} to ${after}`);
}
console.log('program store bounded regression: all passed');
