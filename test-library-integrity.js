import assert from 'node:assert/strict';
import { getCuratedLibraryProjection, CURATED_CHANNEL_WHITELIST } from './src/services/libraryService.ts';
import { getScheduleForGuide, getCanonicalPrograms } from './guideRegistry.ts';

console.log('🧪 Executing Phase 2 Library Provenance & Integrity Gate...');

await getScheduleForGuide('cable-tv');
const canonicalPrograms = getCanonicalPrograms().filter((program) => CURATED_CHANNEL_WHITELIST.has(program.channelId));
assert.ok(canonicalPrograms.length > 0, 'Hydrated TV News producer must populate at least one whitelisted canonical program');

const items = getCuratedLibraryProjection();
assert.ok(Array.isArray(items), 'Projection must return an array');
assert.ok(items.length > 0, 'Curated items must be populated for verified TV News channels');

items.forEach((item, index) => {
  assert.equal(item.sourceId.startsWith('channel-source-'), false, `[Item ${index}] synthetic sourceId detected`);
  assert.equal(item.assetId.startsWith('program-asset-'), false, `[Item ${index}] synthetic assetId detected`);
  assert.notEqual(item.sourceClass, 'm3u_live', `[Item ${index}] m3u_live leaked into Library projection`);
  assert.ok(CURATED_CHANNEL_WHITELIST.has(item.channelId), `[Item ${index}] channel is not whitelisted`);
  assert.equal(item.archivePath.includes('BigBuckBunny'), false, `[Item ${index}] placeholder path detected`);
  assert.ok(['archive_org', 'ajn_archive', 'ajn_rss'].includes(item.sourceClass), `[Item ${index}] unapproved sourceClass`);
});

const ids = items.map((item) => item.id);
assert.equal(new Set(ids).size, ids.length, 'Curated Library must not emit duplicate program IDs');

console.log(`✅ Phase 2 Passed: ${items.length} items verified with canonical provenance.`);
