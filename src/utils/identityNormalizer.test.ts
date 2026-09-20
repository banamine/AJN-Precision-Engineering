import {
  IdentityResolutionError,
  normalizePlaybackIdentity,
} from './identityNormalizer';

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const foxInput = {
  title: 'My View With Lara Trump',
  mediaUrl: 'https://foxnews.example/video/My_View_With_Lara_Trump.mp4',
  guideId: 'cable-tv',
  channelId: 'fox-news',
  publishedAt: '2026-09-20T18:00:00Z',
  feedId: undefined,
};

const first = normalizePlaybackIdentity(foxInput);
const second = normalizePlaybackIdentity(foxInput);

assert(first.guideId === 'cable-tv', 'Fox guideId should be preserved');
assert(first.channelId === 'fox-news', 'Fox channelId should be preserved');
assert(first.sourceId !== 'unknown', 'Fox sourceId must be resolved');
assert(first.assetId !== 'unknown', 'Fox assetId must be resolved');
assert(first.programId !== 'unknown', 'Fox programId must be resolved');
assert(first.assetId === second.assetId, 'assetId must be deterministic');
assert(first.programId === second.programId, 'programId must be deterministic');
assert(first.playbackId === second.playbackId, 'playbackId must be deterministic');

const ajn = normalizePlaybackIdentity({
  feedId: 'AJNHourlyVideo',
  title: 'WAR-ROOM 2026-07-29_Wed_WarRoom-Hr3',
  mediaUrl: 'https://rss.alexjones.media/download/VIDEO%20-%2020260729_Wed_WarRoom-Hr3.mp4',
  feedId: 'AJNHourlyVideo',
});

assert(ajn.guideId === 'ajn-resource', 'AJN guideId should derive from URL');
assert(ajn.channelId === 'ajn-archive', 'AJN channelId should derive from URL');
assert(ajn.sourceId === 'ajn-rss-ajnhourlyvideo', 'AJN sourceId should derive from raw feed metadata');
assert(ajn.assetId !== 'unknown', 'AJN assetId must be resolved');
assert(ajn.programId !== 'unknown', 'AJN programId must be resolved');

let threw = false;
try {
  normalizePlaybackIdentity({
    title: 'Unresolvable',
    mediaUrl: 'blob:not-a-canonical-source',
  });
} catch (error) {
  threw = error instanceof IdentityResolutionError;
}
assert(threw, 'unresolvable identity must throw IdentityResolutionError');

console.log('identity normalizer tests: PASS');
