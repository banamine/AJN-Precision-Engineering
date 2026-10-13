/* Western → Classic TV → Death Valley Days → "The Contract" (S18E24).
 * One curated episode from Archive item 0251114_1101 (a many-episode upload), run as a 24-hour loop:
 * guideRegistry.layoutDailySchedule repeats the single program until the day is full.
 * The file and length below come from https://archive.org/metadata/0251114_1101 (checked 2026-10-04):
 * MPEG4, h.264 + AAC, 65,315,604 bytes, 1542.69 s, not private. No Archive call is made at runtime;
 * the proxy checks the file when it is played, and a failure surfaces as a normal playback error. */
import type { Program } from '../src/types';
import { normalizeProgramIdentity, normalizeAssetIdentity, normalizeSourceIdentity } from '../src/utils/epgIdentity';

export const WESTERN_GROUP = 'Western';
export const DEATH_VALLEY_CHANNEL_ID = 'classic-western-death-valley-days';
export const DEATH_VALLEY_CHANNEL_NAME = 'Death Valley Days — The Contract';
export const DEATH_VALLEY_ITEM = {
  archiveIdentifier: '0251114_1101',
  fileName: 'Death Valley Days S18E24 The Contract.mp4',
  series: 'Death Valley Days',
  season: 18,
  episode: 24,
  episodeTitle: 'The Contract',
  durationSeconds: 1543,
} as const;

/** Archive path with every segment URL-encoded exactly once, ready for the /api/archive/proxy path parameter. */
export const DEATH_VALLEY_MEDIA_PATH =
  `/download/${DEATH_VALLEY_ITEM.archiveIdentifier}/${encodeURIComponent(DEATH_VALLEY_ITEM.fileName)}`;

/** The single base program (not yet laid out in time). */
export function deathValleyBaseProgram(): Program {
  const i = DEATH_VALLEY_ITEM;
  const title = `${i.series} S${i.season}E${i.episode} ${i.episodeTitle}`;
  const mediaUrl = DEATH_VALLEY_MEDIA_PATH;
  return {
    id: normalizeProgramIdentity({ externalId: `${i.archiveIdentifier}|S${i.season}E${i.episode}`, channelId: DEATH_VALLEY_CHANNEL_ID, title, startTime: 0 }),
    guideId: 'classic-tv',
    channelId: DEATH_VALLEY_CHANNEL_ID,
    title,
    description: `Western · Classic TV · ${i.series}. Archive.org item ${i.archiveIdentifier}.`,
    startTime: 0, endTime: 0,
    mediaType: 'video',
    mediaUrl, archivePath: mediaUrl,
    assetId: normalizeAssetIdentity({ externalId: i.archiveIdentifier, mediaUrl }),
    sourceId: normalizeSourceIdentity({ channelId: DEATH_VALLEY_CHANNEL_ID, url: mediaUrl, protocol: 'direct_archive' }),
    sourceClass: 'archive_org',
    isArchivedSource: true,
    metadata: {
      externalId: `${i.archiveIdentifier}|S${i.season}E${i.episode}`,
      archiveIdentifier: i.archiveIdentifier,
      durationSeconds: i.durationSeconds,
      genre: WESTERN_GROUP, series: i.series, season: i.season, episode: i.episode, episodeTitle: i.episodeTitle,
      collectionId: 'western-death-valley-days',
    },
  };
}
