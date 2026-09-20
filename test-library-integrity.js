import assert from 'node:assert/strict';
import { getCuratedLibraryProjection, CURATED_CHANNEL_WHITELIST } from './src/services/libraryService.ts';

console.log('Media Archive Library integrity regression: starting');

const items = getCuratedLibraryProjection();
assert.ok(Array.isArray(items), 'Library projection must return an array');

for (const [index, item] of items.entries()) {
  assert.equal(item.isCurated, true, `[Item ${index}] isCurated must be true`);
  assert.ok(CURATED_CHANNEL_WHITELIST.has(item.channelId), `[Item ${index}] channelId must be whitelisted`);
  assert.ok(item.channelId, `[Item ${index}] missing channelId`);
  assert.ok(item.guideId, `[Item ${index}] missing guideId`);
  assert.ok(item.sourceId, `[Item ${index}] missing sourceId`);
  assert.ok(item.programId, `[Item ${index}] missing programId`);
  assert.ok(item.assetId, `[Item ${index}] missing assetId`);
  assert.ok(item.archivePath, `[Item ${index}] missing archivePath`);
  assert.equal(item.archivePath.includes('BigBuckBunny'), false, `[Item ${index}] placeholder BigBuckBunny path forbidden`);
}

const ids = items.map((item) => item.id);
assert.equal(new Set(ids).size, ids.length, 'Curated Library must not emit duplicate program IDs');

console.log(`Media Archive Library integrity regression: PASS (${items.length} curated items)`);
