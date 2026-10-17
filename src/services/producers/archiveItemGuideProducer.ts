import type { Program, ScheduleChannel } from '../../types';
import { normalizeAssetIdentity, normalizeSourceIdentity } from '../../utils/epgIdentity';

export interface ArchiveItemRow {
  id: string;
  channelId: string;
  channelName: string;
  lane: string;
  kind: 'video' | 'audio';
  title: string;
  series: string | null;
  season: number | null;
  episode: number | null;
  durationSeconds: number | null;
  path: string;
  bytes: number;
  md5: string;
  thumb: string | null;
  guide: boolean;
  reason: string | null;
  conflictWith: string | null;
}

export interface ArchiveItemManifest {
  item: string;
  downloadBase: string;
  channels: {
    id: string;
    name: string;
    guide: boolean;
    conflictWith: string | null;
  }[];
  items: ArchiveItemRow[];
}

export const ADDITIVE_CLASSIC_CHANNELS = new Set([
  'classic-70-odd-couple',
  'classic-rat-patrol',
]);

function normalizedArchiveItemPath(path: string): string {
  let value = path;
  if (value.startsWith('/api/archive/proxy?')) {
    value = new URL(value, 'https://archive.org').searchParams.get('path') ?? value;
  }
  if (/^https?:\/\//i.test(value)) value = new URL(value).pathname;
  try { value = decodeURIComponent(value); } catch { /* Preserve a literal malformed escape. */ }
  return value;
}

/** Comparison only: never use this value as the playback path. */
export function archiveItemPathKey(path: string): string {
  return normalizedArchiveItemPath(path).replace(/\.ia(?=\.mp4$)/i, '');
}

function isArchiveItemIaMp4(path: string): boolean {
  return /\.ia\.mp4$/i.test(normalizedArchiveItemPath(path));
}

function isArchiveItemPlainMp4(path: string): boolean {
  const value = normalizedArchiveItemPath(path);
  return /\.mp4$/i.test(value) && !/\.ia\.mp4$/i.test(value);
}

/** Within the two additive Classic channels, retain the archive.org IA copy. */
function preferArchiveItemIaPrograms(programs: Program[]): Program[] {
  const iaKeys = new Set(programs
    .filter(program => isArchiveItemIaMp4(program.archivePath ?? program.mediaUrl))
    .map(program => archiveItemPathKey(program.archivePath ?? program.mediaUrl)));
  return programs.flatMap(program => {
    const path = program.archivePath ?? program.mediaUrl;
    if (isArchiveItemPlainMp4(path) && iaKeys.has(archiveItemPathKey(path))) return [];
    if (isArchiveItemIaMp4(path) && /\.ia$/i.test(program.title)) {
      return [{ ...program, title: program.title.replace(/\.ia$/i, '') }];
    }
    return [program];
  });
}

/** Copy display metadata only; keep each snapshot program's playback identity intact. */
function applyManifestThumbnails(programs: Program[], manifestPrograms: Program[]): Program[] {
  const manifestByPath = new Map(
    manifestPrograms.map(program => [
      archiveItemPathKey(program.archivePath ?? program.mediaUrl),
      program,
    ]),
  );
  return programs.map(program => {
    const manifestProgram = manifestByPath.get(
      archiveItemPathKey(program.archivePath ?? program.mediaUrl),
    );
    if (!manifestProgram) return program;
    return {
      ...program,
      metadata: {
        ...program.metadata,
        manifestId: manifestProgram.metadata?.manifestId,
        thumbnailUrl: manifestProgram.metadata?.thumbnailUrl,
      },
    };
  });
}

function episodeNumbers(program: Program): [number, number] {
  const match = /S(\d+)E(\d+)/i.exec(program.title)
    ?? /(?:^|[^\d])(\d+)x(\d+)(?:[^\d]|$)/i.exec(program.title);
  const number = (value: unknown, fallback: string | undefined) =>
    typeof value === 'number' && Number.isFinite(value) ? value
      : value === null ? Number.MAX_SAFE_INTEGER
      : fallback !== undefined ? Number(fallback) : Number.MAX_SAFE_INTEGER;
  return [
    number(program.metadata?.season, match?.[1]),
    number(program.metadata?.episode, match?.[2]),
  ];
}

export function sortArchiveItemPrograms(programs: Program[]): Program[] {
  // Array.sort is stable: equal episode keys retain existing rows before additions.
  return [...programs].sort((a, b) => {
    const [as, ae] = episodeNumbers(a);
    const [bs, be] = episodeNumbers(b);
    return as - bs || ae - be;
  });
}

/** Pure mapping of the supplied guide subset; no metadata or media requests. */
export function buildArchiveItemGuideChannels(manifest: ArchiveItemManifest): ScheduleChannel[] {
  if (manifest.item !== '2015-music.-7z' || manifest.downloadBase !== '/download/2015-music.-7z/') {
    throw new Error('Unexpected Archive item guide download base');
  }
  const encodePath = (path: string) =>
    manifest.downloadBase + path.split('/').map(encodeURIComponent).join('/');
  return manifest.channels
    .filter(channel => channel.guide === true && !channel.conflictWith)
    .flatMap(channel => {
      const rows = manifest.items.filter(row =>
        row.channelId === channel.id && row.guide === true && !row.conflictWith);
      if (!rows.length) return [];
      const isMusic = rows.every(row => row.lane === 'music');
      const guideId = isMusic ? 'audio-podcasts' : 'classic-tv';
      const programs: Program[] = rows.map(row => {
        if (row.kind !== 'audio' && row.kind !== 'video') {
          throw new Error(`Invalid manifest media kind: ${row.id}`);
        }
        const archivePath = encodePath(row.path);
        const durationSeconds = typeof row.durationSeconds === 'number'
          && Number.isFinite(row.durationSeconds)
          && row.durationSeconds > 0
          ? row.durationSeconds
          : undefined;
        return {
          id: row.id, guideId: row.lane === 'music' ? 'audio-podcasts' : 'classic-tv', channelId: channel.id,
          title: row.title, description: row.series ?? channel.name,
          mediaType: row.kind, archivePath, mediaUrl: archivePath,
          assetId: normalizeAssetIdentity({ externalId: row.id, programId: row.id, mediaUrl: archivePath }),
          sourceId: normalizeSourceIdentity({
            channelId: channel.id, url: manifest.downloadBase, protocol: 'direct_archive',
          }),
          sourceClass: 'archive_org', isArchivedSource: true, startTime: 0, endTime: 0,
          metadata: {
            externalId: row.id, manifestId: row.id, archiveIdentifier: manifest.item,
            path: row.path, bytes: row.bytes, md5: row.md5, thumb: row.thumb,
            thumbnailUrl: row.thumb === null ? null
              : `/api/archive/proxy?path=${encodeURIComponent(encodePath(row.thumb))}`,
            series: row.series, season: row.season, episode: row.episode,
            lane: row.lane, reason: row.reason,
            ...(durationSeconds === undefined ? {} : { durationSeconds }),
          },
        };
      });
      return [{
        id: channel.id, guideId, name: channel.name,
        mediaType: programs.every(program => program.mediaType === 'audio') ? 'audio' : 'video',
        group: isMusic ? 'Music' : 'Classic TV',
        programs: rows.every(row => row.lane === 'music') ? programs : sortArchiveItemPrograms(programs),
        sourceStatus: 'snapshot',
      } satisfies ScheduleChannel];
    });
}

/**
 * Keep target snapshot rows, preferring .ia.mp4 when both variants exist.
 * Enrich matching rows with manifest thumbnails without changing playback identity.
 * Unrelated existing channels are returned by reference without any changes.
 */
export function mergeArchiveItemGuideChannels(
  existing: ScheduleChannel[],
  additions: ScheduleChannel[],
  snapshotBaseline: ScheduleChannel[] = [],
): ScheduleChannel[] {
  const result = [...existing];
  for (const addition of additions) {
    const index = result.findIndex(channel => channel.id === addition.id);
    const current = index < 0 ? undefined : result[index];
    if (current && !ADDITIVE_CLASSIC_CHANNELS.has(addition.id)) continue;
    if (!ADDITIVE_CLASSIC_CHANNELS.has(addition.id)) {
      result.push(addition);
      continue;
    }
    const baseline = snapshotBaseline.find(channel => channel.id === addition.id);
    const existingPrograms = preferArchiveItemIaPrograms(
      baseline?.programs ?? current?.programs ?? [],
    );
    const programs = applyManifestThumbnails(existingPrograms, addition.programs);
    const seen = new Set(programs.map(program => archiveItemPathKey(program.archivePath ?? program.mediaUrl)));
    const appendNewPaths = (candidates: Program[]) => {
      for (const program of preferArchiveItemIaPrograms(candidates)) {
        const key = archiveItemPathKey(program.archivePath ?? program.mediaUrl);
        if (seen.has(key)) continue;
        seen.add(key);
        programs.push(program);
      }
    };
    // A live refresh cannot discard packaged baseline paths. Preserve new live paths too.
    if (baseline && current) appendNewPaths(current.programs);
    appendNewPaths(addition.programs);
    const merged = {
      ...(current ?? baseline ?? addition),
      programs: sortArchiveItemPrograms(programs),
    };
    if (index < 0) result.push(merged);
    else result[index] = merged;
  }
  return result;
}
