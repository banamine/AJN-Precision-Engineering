import type { Program, ScheduleChannel } from '../../types';
import { normalizeAssetIdentity, normalizeSourceIdentity } from '../../utils/epgIdentity';

export const OLD_BRITISH_TV_GUIDE_ID = 'old-british-tv';

export interface OldBritishTvItem {
  id: string; channelId: string; identifier: string; file: string; title: string; series: string;
  year: string | null; bytes: number; durationSeconds: number; thumb: string | null;
}
export interface OldBritishTvManifest {
  schema: string; source: string;
  channels: { id: string; name: string; description: string }[];
  items: OldBritishTvItem[];
}

const encodePath = (identifier: string, file: string) =>
  `/download/${identifier}/${file.split('/').map(encodeURIComponent).join('/')}`;

/** Pure mapping of the manifest: no network. Real Archive durations only. */
export function buildOldBritishTvChannels(manifest: OldBritishTvManifest): ScheduleChannel[] {
  if (manifest.schema !== 'ajn.oldBritishTvManifest.v1') throw new Error('Unexpected Old British TV manifest schema');
  return manifest.channels.flatMap((channel): ScheduleChannel[] => {
    const rows = manifest.items.filter((row) => row.channelId === channel.id && row.durationSeconds > 0);
    if (!rows.length) return [];
    const programs: Program[] = rows.map((row) => {
      const archivePath = encodePath(row.identifier, row.file);
      const base = `/download/${row.identifier}/`;
      return {
        id: row.id, guideId: OLD_BRITISH_TV_GUIDE_ID, channelId: channel.id,
        title: row.title, description: row.series,
        mediaType: 'video', archivePath, mediaUrl: archivePath,
        assetId: normalizeAssetIdentity({ externalId: row.id, programId: row.id, mediaUrl: archivePath }),
        sourceId: normalizeSourceIdentity({ channelId: channel.id, url: base, protocol: 'direct_archive' }),
        sourceClass: 'archive_org', isArchivedSource: true, startTime: 0, endTime: 0,
        metadata: {
          externalId: row.id, manifestId: row.id, archiveIdentifier: row.identifier, series: row.series,
          year: row.year ?? undefined, bytes: row.bytes, durationSeconds: row.durationSeconds,
          thumbnailUrl: row.thumb ? `/api/archive/proxy?path=${encodeURIComponent(encodePath(row.identifier, row.thumb))}` : null,
        },
      } as Program;
    });
    return [{ id: channel.id, guideId: OLD_BRITISH_TV_GUIDE_ID, name: channel.name, mediaType: 'video', group: 'Old British TV', programs, sourceStatus: 'snapshot' } satisfies ScheduleChannel];
  });
}
