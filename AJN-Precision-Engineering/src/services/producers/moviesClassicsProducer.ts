import { normalizeAssetIdentity, normalizeProgramIdentity, normalizeSourceIdentity } from '../../utils/epgIdentity';
import { buildArchiveProxyUrl } from '../../utils/archivePlayback';
import { validateArchiveAsset } from '../../utils/validateArchiveAsset';
import { Program } from '../../types';

export interface RawArchiveListItem {
  identifier: string;
  title: string;
  year?: number | null;
  files: Array<{ name: string; format: string; title?: string }>;
}

export interface CandidateFile {
  item: RawArchiveListItem;
  file: RawArchiveListItem['files'][number];
  archivePath: string;
  duration?: number;
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

function buildProgram(item: RawArchiveListItem, file: RawArchiveListItem['files'][number], archivePath: string): Program {
  const sourceUrl = `https://archive.org/download/${item.identifier}/`;
  const sourceId = normalizeSourceIdentity({
    channelId: MOVIES_CLASSICS_CHANNEL_ID,
    url: sourceUrl,
    protocol: 'direct_archive',
  });
  const externalId = `${item.identifier}:${file.name}`;
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
    mediaUrl: archivePath,
  });

  return {
    id: programId,
    channelId: MOVIES_CLASSICS_CHANNEL_ID,
    guideId: MOVIES_CLASSICS_GUIDE_ID,
    sourceClass: 'archive_org',
    sourceId,
    assetId,
    title: item.files.length > 1 && file.title ? `${item.title}: ${file.title}` : item.title,
    mediaUrl: buildArchiveProxyUrl(archivePath),
    archivePath,
    mediaType: 'video',
    isArchivedSource: true,
    description: `Classic Cinema Archive: ${item.files.length > 1 && file.title ? `${item.title}: ${file.title}` : item.title}`,
    startTime: item.year ?? 0,
    endTime: item.year ?? 0,
    metadata: {
      externalId,
      archiveIdentifier: item.identifier,
      description: `Classic Cinema Archive: ${item.files.length > 1 && file.title ? `${item.title}: ${file.title}` : item.title}`,
      year: item.year ? String(item.year) : undefined,
      tags: ['classics', 'cinema', 'archive', 'curated'],
    },
  };
}

export function buildMoviesClassicsPrograms(manifestItems: RawArchiveListItem[]): Program[] {
  const programs: Program[] = [];

  for (const item of manifestItems) {
    if (!item.identifier.trim() || !item.title.trim()) continue;
    const playableFiles = item.files.filter(isPlayableVideo);

    for (const file of playableFiles) {
      programs.push(buildProgram(item, file, encodeArchivePath(item.identifier, file.name)));
    }
  }

  return programs;
}

export async function validateMoviesClassicsPrograms(
  manifestItems: RawArchiveListItem[],
  page: any,
): Promise<CandidateFile[]> {
  const candidates: CandidateFile[] = [];

  for (const item of manifestItems) {
    if (!item.identifier.trim() || !item.title.trim()) continue;
    for (const file of item.files.filter(isPlayableVideo)) {
      candidates.push({
        item,
        file,
        archivePath: encodeArchivePath(item.identifier, file.name),
      });
    }
  }

  console.log(`[MovieValidator] Probing ${candidates.length} manifest candidates...`);
  const verified: CandidateFile[] = [];

  for (const candidate of candidates) {
    const title = candidate.item.files.length > 1 && candidate.file.title
      ? `${candidate.item.title}: ${candidate.file.title}`
      : candidate.item.title;
    const result = await validateArchiveAsset(page, candidate.archivePath, title, 10_000);
    if (result.valid) {
      verified.push({ ...candidate, duration: result.duration });
    }
  }

  console.log(`[MovieValidator] ${verified.length}/${candidates.length} candidates passed real browser validation`);
  return verified;
}

export function buildMoviesClassicsFromVerified(verified: CandidateFile[]): Program[] {
  return verified.map((candidate) =>
    buildProgram(candidate.item, candidate.file, candidate.archivePath),
  );
}

export interface ResolvedArchiveFile {
  filename: string;
}

/** Returns candidates, or null when Archive metadata is unavailable (item is then kept unchanged). */
export type ArchiveCandidateResolver = (identifier: string) => Promise<ResolvedArchiveFile[] | null>;

export interface ManifestResolutionReport {
  kept: string[];
  unverified: string[];
  replaced: Array<{ identifier: string; from: string; to: string }>;
  dropped: Array<{ identifier: string; file: string; reason: string }>;
}

/**
 * Check every manifest file against Archive's live metadata instead of trusting
 * the stored filename. A listed file that still exists and is playable is kept.
 * If it is gone, the best browser-playable file (derivative MP4/WebM first, via
 * the resolver) replaces it. Items with no playable file are dropped and reported:
 * nothing is guessed.
 */
export async function resolveMoviesClassicsManifest(
  manifestItems: RawArchiveListItem[],
  resolveCandidates: ArchiveCandidateResolver,
): Promise<{ items: RawArchiveListItem[]; report: ManifestResolutionReport }> {
  const report: ManifestResolutionReport = { kept: [], unverified: [], replaced: [], dropped: [] };
  const items: RawArchiveListItem[] = [];

  for (const item of manifestItems) {
    if (!item.identifier.trim() || !item.title.trim()) continue;
    const candidates = await resolveCandidates(item.identifier);
    if (candidates === null) {
      // Metadata unreachable: this says nothing about the file, so keep it as listed.
      items.push(item);
      report.unverified.push(item.identifier);
      continue;
    }
    const available = new Set(candidates.map((c) => c.filename));
    const files: RawArchiveListItem['files'] = [];

    for (const file of item.files.filter(isPlayableVideo)) {
      if (available.has(file.name)) {
        files.push(file);
        report.kept.push(`${item.identifier}/${file.name}`);
      }
    }

    if (files.length === 0) {
      const best = candidates[0];
      if (best) {
        const listed = item.files[0]?.name ?? '(none)';
        files.push({ name: best.filename, format: best.filename.split('.').pop() ?? '', title: item.title });
        report.replaced.push({ identifier: item.identifier, from: listed, to: best.filename });
      } else {
        for (const file of item.files) {
          report.dropped.push({ identifier: item.identifier, file: file.name, reason: 'no browser-playable file in Archive metadata' });
        }
        continue;
      }
    }

    items.push({ ...item, files });
  }

  return { items, report };
}
