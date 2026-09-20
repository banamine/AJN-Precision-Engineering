import { normalizeAssetIdentity, normalizeProgramIdentity, normalizeSourceIdentity } from '../../utils/epgIdentity';
import { buildArchiveProxyUrl } from '../../utils/archivePlayback';
import { Program } from '../../types';

const NOVA_ITEM_ID = 'nova-wonders';
const NOVA_FILES = [
  { ep: 1, title: 'Animal Communication', file: 'NOVA Wonders 1 Animal Communication.mp4' },
  { ep: 2, title: 'Living in You', file: 'NOVA Wonders 2 Living in You.mp4' },
  { ep: 3, title: 'Are We Alone', file: 'NOVA Wonders 3 Are we Alone.mp4' },
  { ep: 4, title: 'Build a Brain', file: 'NOVA Wonders 4 Build a Brain.mp4' },
  { ep: 5, title: 'Making Life', file: 'NOVA Wonders 5 Making Life.mp4' },
  { ep: 6, title: 'What Is the Universe Made Of', file: 'NOVA Wonders 6 What is Universe made of.mp4' },
] as const;

function encodeArchivePath(file: string): string {
  return `/download/${NOVA_ITEM_ID}/${file.split('/').map(encodeURIComponent).join('/')}`;
}

export function getNovaCanonicalPrograms(): Program[] {
  const sourceUrl = `https://archive.org/download/${NOVA_ITEM_ID}/`;
  const sourceId = normalizeSourceIdentity({ channelId: NOVA_ITEM_ID, url: sourceUrl, protocol: 'direct_archive' });

  return NOVA_FILES.map((item) => {
    const archivePath = encodeArchivePath(item.file);
    const mediaUrl = buildArchiveProxyUrl(archivePath);
    const externalId = `${NOVA_ITEM_ID}:${item.file}`;
    const programId = normalizeProgramIdentity({ externalId, channelId: NOVA_ITEM_ID, title: item.title, startTime: item.ep });
    const assetId = normalizeAssetIdentity({ externalId, archiveIdentifier: NOVA_ITEM_ID, programId, mediaUrl: archivePath });

    return {
      id: programId,
      channelId: NOVA_ITEM_ID,
      guideId: 'science-documentaries',
      sourceClass: 'archive_org',
      sourceId,
      assetId,
      title: `NOVA Wonders: ${item.title}`,
      description: `NOVA Wonders Episode ${item.ep}: ${item.title}`,
      startTime: item.ep,
      endTime: item.ep,
      mediaUrl,
      archivePath,
      mediaType: 'video',
      isArchivedSource: true,
      metadata: {
        externalId,
        description: `NOVA Wonders Episode ${item.ep}: ${item.title}`,
        year: '2018',
        tags: ['documentary', 'science', 'nova', 'curated'],
      },
    } satisfies Program;
  });
}
