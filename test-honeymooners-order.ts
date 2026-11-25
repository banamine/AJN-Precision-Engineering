import assert from 'node:assert/strict';
import { buildHoneymoonersEpg, resolveHoneymoonersAssets } from './collections/honeymooners-epg';
import type { ArchiveCollectionItem } from './collections/honeymooners-collection';

const identifiers = ['itemZ', 'itemA', 'item2', 'item10', 'item01'];
const collection: ArchiveCollectionItem[] = identifiers.map(archiveIdentifier => ({
  id: `collection-${archiveIdentifier}`, title: archiveIdentifier, archiveIdentifier,
  archiveUrl: `https://archive.org/details/${archiveIdentifier}`,
  mediaType: 'video', collection: 'honeymooners',
}));
const expectedOrder = ['item01', 'item10', 'item2', 'itemA', 'itemZ'];

async function resolve(reverse: boolean, failed?: string) {
  let active = 0;
  let peak = 0;
  const started: string[] = [];
  const completed: string[] = [];
  const assets = await resolveHoneymoonersAssets({
    collection: reverse ? [...collection].reverse() : collection,
    loadMetadata: async identifier => {
      started.push(identifier);
      active++;
      peak = Math.max(peak, active);
      const rank = expectedOrder.indexOf(identifier);
      await new Promise(resolve => setTimeout(resolve, reverse ? 4 + rank * 4 : 24 - rank * 4));
      active--;
      completed.push(identifier);
      if (identifier === failed) return null; // production fetch failures return null
      const files = [
        { name: 'Episode2.mp4', length: '100' },
        { name: 'Episode10.mp4', length: '100' },
        { name: 'Episode01.mp4', length: '10' },
        { name: 'thumbnail.jpg', length: '1000' },
      ];
      return { files: reverse ? files.reverse() : files };
    },
  });
  assert.deepEqual(started, expectedOrder, 'dispatch order must be sorted before any fetch');
  assert.equal(peak, 4, 'four requests must remain concurrent');
  assert.equal(active, 0);
  assert.deepEqual(assets.map(asset => asset.archiveIdentifier),
    expectedOrder.filter(identifier => identifier !== failed));
  assert.ok(assets.every(asset => asset.mediaUrl.endsWith('/Episode10.mp4')),
    'longest-duration ties must use canonical path lexical order (10 before 2)');
  return { assets, completed, requests: started.length, peak };
}

const a = await resolve(false);
const b = await resolve(true);
assert.notDeepEqual(a.completed, b.completed, 'fixture must exercise different completion orders');
assert.deepEqual(a.assets, b.assets, 'metadata file order and worker timing must not change assets');
assert.equal(a.requests + b.requests, 10, 'second resolver invocation must refetch, not reuse a cache');

const failedA = await resolve(false, 'item2');
const failedB = await resolve(true, 'item2');
assert.deepEqual(failedA.assets, failedB.assets, 'fast/slow failures must not reorder survivors');

// Duplicate source winners are determined after sorting, not by the fastest worker.
const duplicates = [collection[3], { ...collection[3], id: 'aaa-duplicate' }];
const duplicateAssets = await resolveHoneymoonersAssets({
  collection: duplicates,
  loadMetadata: async () => ({ files: [{ name: 'Same File.mp4', length: 100 }] }),
});
assert.equal(duplicateAssets.length, 1);
assert.equal(duplicateAssets[0].id, 'asset-aaa-duplicate');
assert.equal(duplicateAssets[0].mediaUrl, '/download/item10/Same%20File.mp4');

const originalInput = JSON.stringify(a.assets);
const early = await buildHoneymoonersEpg(a.assets, new Date('2026-10-07T01:23:45.123Z'));
const late = await buildHoneymoonersEpg([...b.assets].reverse(), new Date('2026-10-07T23:59:59.999Z'));
assert.deepEqual(early, late, 'same UTC day must produce identical full EPG with no normalization');
assert.equal(JSON.stringify(a.assets), originalInput, 'injected assets must not be mutated');
assert.equal(early.programs[0].startTimeUtc, '2026-10-07T00:00:00.000Z');
assert.equal(early.programs.at(-1)?.endTimeUtc, '2026-10-08T00:00:00.000Z');
assert.equal(early.programs.at(-1)?.endTime, 24);
for (let i = 1; i < early.programs.length; i++) {
  assert.equal(early.programs[i].startTimeUtc, early.programs[i - 1].endTimeUtc);
  assert.equal(early.programs[i].startTime, early.programs[i - 1].endTime);
}
const nextDay = await buildHoneymoonersEpg(a.assets, new Date('2026-10-08T00:00:00Z'));
assert.equal(nextDay.programs[0].startTimeUtc, '2026-10-08T00:00:00.000Z');
assert.deepEqual(nextDay.programs.map(program => program.archivePath),
  early.programs.map(program => program.archivePath));
const empty = await resolveHoneymoonersAssets({
  collection: [], loadMetadata: async () => { throw new Error('empty collection must not fetch'); },
});
assert.deepEqual(empty, []);
console.log(JSON.stringify({
  sort: 'canonical encoded source path ascending, case-sensitive lexical; filename then collection ID',
  sortedSources: expectedOrder,
  concurrentWorkers: a.peak,
  differentCompletionOrders: [a.completed, b.completed],
  sameDayFullEpgEqual: true,
  normalizedFields: [],
  midnightStart: early.programs[0].startTimeUtc,
  finalEnd: early.programs.at(-1)?.endTimeUtc,
}));
console.log('Honeymooners deterministic ordering, duration ties, concurrent failures, deduplication and UTC-day clock: PASS');
