import { getCanonicalPrograms } from '../../guideRegistry';
import { LibraryItem, Program } from '../../src/types';

export const CURATED_CHANNEL_WHITELIST = new Set<string>();

function mapChannelToCategory(program: Program): LibraryItem['category'] {
  const channelId = program.channelId.toLowerCase();
  if (channelId === 'nova-wonders' || channelId.includes('documentary')) return 'documentary';
  if (channelId.includes('news') || ['fox-news', 'cnn', 'msnbc'].includes(channelId)) return 'news';
  if (program.mediaType === 'audio' || channelId.includes('audio') || channelId.includes('radio')) return 'audio';
  if (channelId.includes('classic') || channelId.includes('cinema') || channelId === 'honeymooners') return 'classics';
  return 'science';
}

function formatDuration(program: Program): string {
  if (typeof program.metadata?.durationSeconds === 'number' && Number.isFinite(program.metadata.durationSeconds)) {
    const total = Math.max(0, Math.round(program.metadata.durationSeconds));
    const minutes = Math.floor(total / 60);
    return minutes > 0 ? `${minutes} mins` : `${total} secs`;
  }
  return 'Archive program';
}

export function getCuratedLibraryProjection(
  channelWhitelist: ReadonlySet<string> = CURATED_CHANNEL_WHITELIST,
): LibraryItem[] {
  return getCanonicalPrograms()
    .filter((program) => channelWhitelist.has(program.channelId))
    .map((program) => ({
      id: program.id,
      title: program.title,
      description: program.description || 'Curated broadcast archive item.',
      category: mapChannelToCategory(program),
      archivePath: program.archivePath || program.mediaUrl,
      duration: formatDuration(program),
      format: program.mediaType === 'audio' ? 'Audio' : 'Video',
      year: typeof program.metadata?.year === 'string' ? program.metadata.year : undefined,
      source: program.sourceClass || 'archive_org',
      tags: Array.isArray(program.metadata?.tags) ? program.metadata.tags : ['archive', 'curated'],
      channelId: program.channelId,
      guideId: program.guideId,
      isCurated: true,
      sourceId: program.sourceId || `channel-source-${program.channelId}`,
      programId: program.id,
      assetId: program.assetId || `program-asset-${program.id}`,
      sourceClass: program.sourceClass === 'ajn_archive' || program.sourceClass === 'ajn_rss' ? program.sourceClass : 'archive_org',
    }));
}
