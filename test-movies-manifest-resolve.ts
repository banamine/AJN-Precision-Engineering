// Regression: Movies & Classics manifest is resolved against Archive metadata, never guessed.
import assert from 'node:assert/strict';
import { resolveMoviesClassicsManifest, type RawArchiveListItem } from './src/services/producers/moviesClassicsProducer.ts';

const manifest: RawArchiveListItem[] = [
  { identifier: 'KeepMe', title: 'Keep', files: [{ name: 'KeepMe.mp4', format: 'MPEG4' }] },
  { identifier: 'Renamed', title: 'Renamed', files: [{ name: 'Renamed.mp4', format: 'MPEG4' }] },
  { identifier: 'Gone', title: 'Gone', files: [{ name: 'Gone.mp4', format: 'MPEG4' }] },
];
const metadata: Record<string, string[]> = {
  KeepMe: ['KeepMe.mp4'],
  Renamed: ['Renamed_512kb.mp4', 'Renamed.mpeg'],
  Gone: [],
};
const { items, report } = await resolveMoviesClassicsManifest(manifest, async (id) =>
  (metadata[id] ?? []).filter((n) => /\.(mp4|webm)$/.test(n)).map((filename) => ({ filename })),
);

assert.deepEqual(items.map((i) => i.files[0].name), ['KeepMe.mp4', 'Renamed_512kb.mp4']);
assert.deepEqual(report.kept, ['KeepMe/KeepMe.mp4']);
assert.deepEqual(report.replaced, [{ identifier: 'Renamed', from: 'Renamed.mp4', to: 'Renamed_512kb.mp4' }]);
assert.equal(report.dropped.length, 1);
assert.equal(report.dropped[0].identifier, 'Gone');
// Metadata outage must not empty the channel.
{
  const outage = await resolveMoviesClassicsManifest(manifest, async () => null);
  assert.equal(outage.items.length, 3);
  assert.deepEqual(outage.report.unverified, ['KeepMe', 'Renamed', 'Gone']);
  assert.equal(outage.report.dropped.length, 0);
}
console.log('movies manifest resolve regression: all passed');
