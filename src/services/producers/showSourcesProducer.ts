import type { Program, ScheduleChannel } from '../../types';
import { normalizeAssetIdentity, normalizeSourceIdentity } from '../../utils/epgIdentity';
import { archiveItemPathKey } from './archiveItemGuideProducer';

export interface ShowSourceRow {
  id: string; channelId: string; channelName: string; identifier: string; file: string; title: string; series: string;
  bytes: number; durationSeconds: number; thumb: string | null;
}
export interface ShowSourcesManifest { schema: string; items: ShowSourceRow[] }

const encodePath = (identifier: string, file: string) =>
  `/download/${identifier}/${file.split('/').map(encodeURIComponent).join('/')}`;

export function toProgram(row: ShowSourceRow, guideId: string): Program {
  const archivePath = encodePath(row.identifier, row.file);
  return {
    id: row.id, guideId, channelId: row.channelId, title: row.title, description: row.series,
    mediaType: 'video', archivePath, mediaUrl: archivePath,
    assetId: normalizeAssetIdentity({ externalId: row.id, programId: row.id, mediaUrl: archivePath }),
    sourceId: normalizeSourceIdentity({ channelId: row.channelId, url: `/download/${row.identifier}/`, protocol: 'direct_archive' }),
    sourceClass: 'archive_org', isArchivedSource: true, startTime: 0, endTime: 0,
    metadata: {
      externalId: row.id, manifestId: row.id, archiveIdentifier: row.identifier, series: row.series,
      bytes: row.bytes, durationSeconds: row.durationSeconds,
      thumbnailUrl: row.thumb ? `/api/archive/proxy?path=${encodeURIComponent(encodePath(row.identifier, row.thumb))}` : null,
    },
  } as Program;
}

/** Append extra Archive sources to existing channels (new channel if the id is unknown). Pure; no network.
 *  A file already present in the channel (same Archive path) is never added twice. */
export function applyShowSources(channels: ScheduleChannel[], manifest: ShowSourcesManifest, guideId = 'classic-tv'): ScheduleChannel[] {
  if (manifest.schema !== 'ajn.archiveShowSourcesManifest.v1') throw new Error('Unexpected show sources manifest schema');
  const result = [...channels];
  const names = new Map(manifest.items.map((r) => [r.channelId, r.channelName]));
  for (const [channelId, name] of names) {
    const rows = manifest.items.filter((r) => r.channelId === channelId && r.durationSeconds > 0);
    const index = result.findIndex((c) => c.id === channelId);
    const current = index < 0 ? undefined : result[index];
    const seen = new Set((current?.programs ?? []).map((p) => archiveItemPathKey(p.archivePath ?? p.mediaUrl)));
    const added: Program[] = [];
    for (const row of rows) {
      const program = toProgram(row, guideId);
      const key = archiveItemPathKey(program.archivePath ?? program.mediaUrl);
      if (seen.has(key)) continue;
      seen.add(key); added.push(program);
    }
    if (!added.length) continue;
    if (current) result[index] = { ...current, programs: [...current.programs, ...added] };
    else result.push({ id: channelId, guideId, name, mediaType: 'video', group: 'Classic TV', programs: added, sourceStatus: 'snapshot' });
  }
  return result;
}
