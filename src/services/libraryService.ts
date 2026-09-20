import { getCanonicalPrograms } from '../../guideRegistry';
import { LibraryItem, Program } from '../../src/types';

export const CURATED_CHANNEL_WHITELIST = new Set<string>([
  'fox-news',
  'cnn',
  'msnbc',
  'nova-wonders',
  'classic-cinema',
]);

const APPROVED_SOURCE_CLASSES = new Set<NonNullable<Program['sourceClass']>>([
  'archive_org',
  'ajn_archive',
  'ajn_rss',
]);

function mapChannelToCategory(channelId: string): LibraryItem['category'] {
  if (['fox-news', 'cnn', 'msnbc'].includes(channelId)) return 'news';
  if (channelId.includes('audio')) return 'audio';
  if (channelId.includes('cinema')) return 'classics';
  return 'science';
}

export function getCuratedLibraryProjection(): LibraryItem[] {
  return getCanonicalPrograms()
    .filter((program) => {
      if (!CURATED_CHANNEL_WHITELIST.has(program.channelId)) return false;
      if (!program.sourceClass || !APPROVED_SOURCE_CLASSES.has(program.sourceClass)) return false;
      if (!program.sourceId?.trim() || !program.assetId?.trim()) return false;
      return true;
    })
    .map((program) => ({
      id: program.id,
      title: program.title,
      description: program.description || 'Curated broadcast archive item.',
      category: mapChannelToCategory(program.channelId),
      archivePath: program.archivePath || program.mediaUrl,
      duration: 'Archive program',
      format: program.mediaType === 'audio' ? 'Audio' : 'Video',
      year: typeof program.metadata?.year === 'string' ? program.metadata.year : undefined,
      source: program.sourceClass,
      tags: Array.isArray(program.metadata?.tags) ? program.metadata.tags : ['curated', 'archive'],
      channelId: program.channelId,
      guideId: program.guideId,
      isCurated: true,
      sourceId: program.sourceId,
      programId: program.id,
      assetId: program.assetId,
      sourceClass: program.sourceClass as LibraryItem['sourceClass'],
    }));
}
