import { canonicalizeAjnFeedItems } from './ajnResourceService.ts';
import { getCanonicalPrograms } from './guideRegistry.ts';
import { normalizeProgramIdentity, normalizeAssetIdentity } from './src/utils/epgIdentity.ts';

function assert(condition, message) { if (!condition) throw new Error(message); }

console.log('AJN RSS canonical producer regression: starting');

const publishedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();

const items = [
  {
    id: 'Alex:guid-123',
    feedId: 'Alex',
    title: 'AJN Test Show',
    url: 'https://cdn.example.test/show.mp4?token=rotating',
    mediaType: 'video',
    publishedAt,
    description: 'Test item',
    metadata: { guid: 'guid-123', author: 'Test', sourceFeed: 'https://rss.example.test/Alex.xml' },
  },
];

const beforeCanonicalCount = getCanonicalPrograms().filter(program => program.metadata?.externalId === 'guid-123').length;
const first = canonicalizeAjnFeedItems(items);
assert(first.length === 1, 'One RSS item should produce one canonical program');
assert(first[0].sourceClass === 'ajn_rss', 'RSS producer must mark sourceClass=ajn_rss');
assert(first[0].metadata?.externalId === 'guid-123', 'RSS guid must become canonical externalId');
assert(first[0].assetId, 'RSS program must receive canonical assetId');

const expectedProgramId = normalizeProgramIdentity({
  externalId: 'guid-123',
  channelId: 'ajn-feed-alex',
  title: 'AJN Test Show',
  startTime: publishedAt,
});
assert(first[0].id === expectedProgramId, 'RSS guid must deterministically define programId');

const expectedAssetId = normalizeAssetIdentity({
  externalId: 'guid-123',
  programId: expectedProgramId,
  mediaUrl: items[0].url,
});
assert(first[0].assetId === expectedAssetId, 'RSS item must deterministically define assetId');

const afterFirstCanonicalCount = getCanonicalPrograms().filter(
  program => program.metadata?.externalId === 'guid-123'
).length;
assert(
  afterFirstCanonicalCount === Math.max(1, beforeCanonicalCount),
  'First RSS ingestion must establish exactly one canonical program for the identity'
);

const second = canonicalizeAjnFeedItems([
  { ...items[0], url: 'https://cdn.example.test/show.mp4?token=rotated' },
]);
assert(second[0].id === first[0].id, 'Transport token rotation must not change RSS program identity');

const afterRepeatCanonicalCount = getCanonicalPrograms().filter(
  program => program.metadata?.externalId === 'guid-123'
).length;
assert(
  afterRepeatCanonicalCount === afterFirstCanonicalCount,
  'Repeated RSS ingestion must not duplicate canonical programs'
);
assert(
  getCanonicalPrograms().filter(program => program.metadata?.externalId === 'guid-123')[0]?.id === first[0].id,
  'Repeated RSS ingestion must preserve canonical program identity'
);

canonicalizeAjnFeedItems([
  { ...items[0], url: 'https://cdn.example.test/show.mp4?token=rotated-again' },
]);
const afterThirdCanonicalCount = getCanonicalPrograms().filter(
  program => program.metadata?.externalId === 'guid-123'
).length;
assert(
  afterThirdCanonicalCount === afterRepeatCanonicalCount,
  'Subsequent RSS ingestion must not duplicate canonical programs'
);

console.log('AJN RSS canonical producer regression: PASS');
