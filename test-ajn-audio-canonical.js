import { canonicalizeAjnAudioItems } from './ajnResourceService.ts';
import { getCanonicalPrograms } from './guideRegistry.ts';

function assert(condition, message) { if (!condition) throw new Error(message); }

console.log('AJN audio canonical producer regression: starting');

const publishedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const item = {
  id: 'ajn:hourly:https://cdn.example.test/audio/hour-001.mp3?token=alpha',
  feedId: 'AJNHourlyAudio',
  title: 'Hourly Test Segment',
  url: 'https://cdn.example.test/audio/hour-001.mp3?token=alpha',
  mediaType: 'audio',
  publishedAt,
  metadata: {
    sourceIndex: 'https://rss.alexjones.media/mp3-hourly.html',
    resourceKind: 'hourly',
    authoritative: 'true',
  },
};

const first = canonicalizeAjnAudioItems([item], 'hourly');
assert(first.length === 1, 'One audio item should produce one canonical program');
assert(first[0].sourceClass === 'ajn_archive', 'Audio archive producer must mark sourceClass=ajn_archive');
assert(first[0].channelId === 'ajn-audio-hourly', 'Hourly audio must use canonical channel ID');
assert(first[0].assetId, 'Audio program must receive canonical assetId');

const second = canonicalizeAjnAudioItems([
  { ...item, url: 'https://cdn.example.test/audio/hour-001.mp3?token=beta', publishedAt },
], 'hourly');

assert(second[0].id === first[0].id, 'Stable audio item identity must survive transport token rotation');

const later = canonicalizeAjnAudioItems([
  { ...item, url: 'https://cdn.example.test/audio/hour-001.mp3?token=gamma', publishedAt: '2026-09-20T10:00:00Z' },
], 'hourly');

assert(later[0].id === first[0].id, 'Repeated audio ingestion must preserve program identity across polling cycles');
assert(getCanonicalPrograms().filter(program => program.id === first[0].id).length === 1, 'Repeated audio ingestion must not duplicate canonical programs');

const segment = canonicalizeAjnAudioItems([
  { ...item, id: 'ajn:segment:https://cdn.example.test/audio/seg-001.mp3', url: 'https://cdn.example.test/audio/seg-001.mp3', metadata: { ...item.metadata, resourceKind: 'segment' } },
], 'segment');
assert(segment[0].channelId === 'ajn-audio-segment', 'Segment audio must use canonical segment channel ID');
assert(segment[0].sourceClass === 'ajn_archive', 'Segment audio must remain classified as ajn_archive');
assert(segment[0].id !== first[0].id, 'Distinct audio archive items must remain distinct');

console.log('AJN audio canonical producer regression: PASS');
