import { Program, MediaType } from '../types';
import { normalizeAssetIdentity, normalizeChannelIdentity, normalizeProgramIdentity, normalizeSourceIdentity, sanitizeIdentityUrl } from '../utils/epgIdentity';

export type GenreEvidenceOrigin = 'discovery' | 'user';
export type GenreEvidenceType = 'search-result' | 'catalog-page' | 'api-record' | 'repository' | 'archive-metadata' | 'manifest' | 'identifier' | 'url' | 'metadata' | 'file' | 'curated-list';

export interface GenreMediaFile {
  name: string;
  format?: string;
  title?: string;
  mediaUrl?: string;
}

export interface GenreExpansionCandidate {
  origin: GenreEvidenceOrigin;
  evidenceType: GenreEvidenceType;
  sourceUrl?: string;
  identifier?: string;
  title?: string;
  channelExternalId?: string;
  channelName?: string;
  guideId: string;
  mediaType: MediaType;
  mediaUrl?: string;
  startTime?: number | string | Date;
  archiveIdentifier?: string;
  sourceClass: NonNullable<Program['sourceClass']>;
  metadata?: Record<string, any>;
  files?: GenreMediaFile[];
  retrievedAt?: string;
}

export interface GenreExpansionConflict {
  kind: 'duplicate' | 'conflict';
  identity: string;
  message: string;
  candidateIndex: number;
}

export interface GenreExpansionResult {
  programs: Program[];
  rejected: Array<{ candidateIndex: number; reason: string }>;
  conflicts: GenreExpansionConflict[];
}

const PLAYABLE_EXTENSIONS = new Set(['.mp3', '.m4a', '.mp4', '.mkv', '.mov', '.ogv', '.webm', '.wav']);
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const ALLOWED_SOURCE_CLASSES = new Set<NonNullable<Program['sourceClass']>>(['archive_org', 'ajn_archive', 'ajn_rss']);

function isValidUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return ALLOWED_PROTOCOLS.has(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function isPlayableFile(file: GenreMediaFile): boolean {
  const format = (file.format || '').trim().toLowerCase();
  const name = file.name.trim().toLowerCase();
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  if (format.includes('mpeg4') || format.includes('h.264') || format === 'matroska' || format.includes('mp3') || format.includes('audio')) return true;
  return PLAYABLE_EXTENSIONS.has(extension);
}

function encodePath(identifier: string, fileName: string): string {
  return `/download/${identifier}/${fileName.split('/').map(encodeURIComponent).join('/')}`;
}

function sourceUrlFor(candidate: GenreExpansionCandidate): string {
  if (candidate.sourceUrl) return sanitizeIdentityUrl(candidate.sourceUrl);
  if (candidate.archiveIdentifier) return `https://archive.org/download/${encodeURIComponent(candidate.archiveIdentifier)}/`;
  return '';
}

export function expandGenreCandidates(candidates: GenreExpansionCandidate[]): GenreExpansionResult {
  const programs: Program[] = [];
  const rejected: GenreExpansionResult['rejected'] = [];
  const conflicts: GenreExpansionConflict[] = [];
  const seenPrograms = new Map<string, Program>();

  candidates.forEach((candidate, candidateIndex) => {
    const title = candidate.title?.trim();
    const sourceUrl = sourceUrlFor(candidate);
    if (!title) return rejected.push({ candidateIndex, reason: 'title is required' });
    if (!candidate.guideId.trim()) return rejected.push({ candidateIndex, reason: 'guideId is required' });
    if (!candidate.sourceClass) return rejected.push({ candidateIndex, reason: 'sourceClass is required' });
    if (!ALLOWED_SOURCE_CLASSES.has(candidate.sourceClass)) return rejected.push({ candidateIndex, reason: 'sourceClass is not allowed for genre expansion' });
    if (!sourceUrl || !isValidUrl(sourceUrl)) return rejected.push({ candidateIndex, reason: 'valid sourceUrl is required' });

    const channelId = normalizeChannelIdentity({
      externalId: candidate.channelExternalId,
      name: candidate.channelName || candidate.title,
      guideId: candidate.guideId,
    });
    const sourceId = normalizeSourceIdentity({ channelId, url: sourceUrl, protocol: candidate.sourceClass === 'archive_org' ? 'direct_archive' : 'https' });

    const mediaFiles = candidate.files?.filter(isPlayableFile) || [];
    const representations = mediaFiles.length > 0
      ? mediaFiles.map((file) => ({
          externalId: candidate.identifier ? `${candidate.identifier}:${file.name}` : undefined,
          mediaUrl: file.mediaUrl || (candidate.archiveIdentifier ? encodePath(candidate.archiveIdentifier, file.name) : undefined),
          title: file.title ? `${title}: ${file.title}` : title,
        }))
      : [{ externalId: candidate.identifier, mediaUrl: candidate.mediaUrl, title }];

    if (representations.some((item) => !item.mediaUrl)) return rejected.push({ candidateIndex, reason: 'playable mediaUrl is required' });
    if (representations.some((item) => !isValidUrl(item.mediaUrl) && !item.mediaUrl!.startsWith('/download/'))) {
      return rejected.push({ candidateIndex, reason: 'mediaUrl must be an absolute HTTP(S) URL or canonical archive path' });
    }

    for (const representation of representations) {
      let programId: string;
      try {
        programId = normalizeProgramIdentity({
          externalId: representation.externalId,
          channelId,
          title: representation.title,
          startTime: candidate.startTime,
        });
      } catch (error) {
        return rejected.push({ candidateIndex, reason: error instanceof Error ? error.message : 'invalid program identity' });
      }

      const assetId = normalizeAssetIdentity({
        externalId: representation.externalId,
        archiveIdentifier: candidate.archiveIdentifier,
        programId,
        mediaUrl: representation.mediaUrl,
      });
      const existing = seenPrograms.get(programId);
      if (existing) {
        const existingUrl = sanitizeIdentityUrl(existing.mediaUrl);
        const incomingUrl = sanitizeIdentityUrl(representation.mediaUrl!);
        if (existingUrl !== incomingUrl || existing.title !== representation.title) {
          conflicts.push({ kind: 'conflict', identity: programId, candidateIndex, message: 'same program identity resolved to incompatible metadata or media' });
        } else {
          conflicts.push({ kind: 'duplicate', identity: programId, candidateIndex, message: 'duplicate evidence resolved to an existing canonical program' });
        }
        continue;
      }

      const program: Program = {
        id: programId,
        guideId: candidate.guideId,
        channelId,
        title: representation.title,
        description: typeof candidate.metadata?.description === 'string' ? candidate.metadata.description : undefined,
        startTime: typeof candidate.startTime === 'number' ? candidate.startTime : 0,
        endTime: typeof candidate.startTime === 'number' ? candidate.startTime : 0,
        mediaType: candidate.mediaType,
        mediaUrl: representation.mediaUrl!,
        archivePath: representation.mediaUrl!.startsWith('/download/') ? representation.mediaUrl : undefined,
        assetId,
        sourceId,
        sourceClass: candidate.sourceClass,
        isArchivedSource: candidate.sourceClass !== 'm3u_live',
        metadata: {
          ...candidate.metadata,
          externalId: representation.externalId,
          sourceUrl,
          identifier: candidate.identifier,
          origin: candidate.origin,
          evidenceType: candidate.evidenceType,
          retrievedAt: candidate.retrievedAt,
        },
      };
      seenPrograms.set(program.id, program);
      programs.push(program);
    }
  });

  return { programs, rejected, conflicts };
}
