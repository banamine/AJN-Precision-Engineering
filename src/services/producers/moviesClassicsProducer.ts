import { normalizeAssetIdentity, normalizeProgramIdentity, normalizeSourceIdentity } from '../../utils/epgIdentity';
import { Program } from '../../types';

export interface RawArchiveListItem {
  identifier: string;
  title: string;
  year?: number;
  files: Array<{ name: string; format: string; title?: string }>;
}

export const MOVIES_CLASSICS_CHANNEL_ID = 'classic-cinema';
export const MOVIES_CLASSICS_GUIDE_ID = 'movies-classics-vault';

const PLAYABLE_FORMATS = new Set(['mpeg4', '512kb mpeg4', 'h.264', 'matroska']);
const PLAYABLE_EXTENSIONS = new Set(['.mp4', '.mkv', '.ogv']);

function isPlayableVideo(file: RawArchiveListItem['files'][number]): boolean {
  const format = file.format.trim().toLowerCase();
  const name = file.name.trim().toLowerCase();
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  return PLAYABLE_FORMATS.has(format) || PLAYABLE_EXTENSIONS.has(extension);
}

function encodeArchivePath(identifier: string, fileName: string): string {
  return `/download/${identifier}/${fileName.split('/').map(encodeURIComponent).join('/')}`;
}

export function buildMoviesClassicsPrograms(manifestItems: RawArchiveListItem[]): Program[] {
  const programs: Program[] = [];

  for (const item of manifestItems) {
    if (!item.identifier.trim() || !item.title.trim()) continue;

    const sourceUrl = `https://archive.org/download/${item.identifier}/`;
    const sourceId = normalizeSourceIdentity({
      channelId: MOVIES_CLASSICS_CHANNEL_ID,
      url: sourceUrl,
      protocol: 'direct_archive',
    });

    const playableFiles = item.files.filter(isPlayableVideo);

    for (const file of playableFiles) {
      const externalId = `${item.identifier}:${file.name}`;
      const mediaUrl = encodeArchivePath(item.identifier, file.name);
      const programId = normalizeProgramIdentity({
        externalId,
        channelId: MOVIES_CLASSICS_CHANNEL_ID,
        title: item.title,
        startTime: item.year ?? 0,
      });
      const assetId = normalizeAssetIdentity({
        externalId,
        archiveIdentifier: item.identifier,
        programId,
        mediaUrl,
      });
      const programTitle = playableFiles.length > 1 && file.title
        ? `${item.title}: ${file.title}`
        : item.title;

      programs.push({
        id: programId,
        channelId: MOVIES_CLASSICS_CHANNEL_ID,
        guideId: MOVIES_CLASSICS_GUIDE_ID,
        sourceClass: 'archive_org',
        sourceId,
        assetId,
        title: programTitle,
        mediaUrl,
        archivePath: mediaUrl,
        mediaType: 'video',
        isArchivedSource: true,
        description: `Classic Cinema Archive: ${programTitle}`,
        startTime: item.year ?? 0,
        endTime: item.year ?? 0,
        metadata: {
          externalId,
          archiveIdentifier: item.identifier,
          description: `Classic Cinema Archive: ${programTitle}`,
          year: item.year ? String(item.year) : undefined,
          tags: ['classics', 'cinema', 'archive', 'curated'],
        },
      });
    }
  }

  return programs;
}
