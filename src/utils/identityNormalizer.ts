import type { PlaybackIdentity, PlaybackIdentityInput } from '../types';

export class IdentityResolutionError extends Error {
  constructor(
    message: string,
    public readonly input: PlaybackIdentityInput,
  ) {
    super(message);
    this.name = 'IdentityResolutionError';
  }
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function cleanCandidate(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized || normalized.toLowerCase() === 'unknown') return undefined;
  return normalized;
}

function parseMediaUrl(mediaUrl: string): URL | null {
  try {
    return new URL(mediaUrl, 'http://ajn.local');
  } catch {
    return null;
  }
}

function deriveGuideFromUrl(mediaUrl: string): string | null {
  const url = parseMediaUrl(mediaUrl);
  const source = (url?.hostname || '') + (url?.pathname || '');
  const normalized = source.toLowerCase();

  if (normalized.includes('alexjones.media')) return 'ajn-resource';
  if (normalized.includes('fox')) return 'cable-tv';
  if (normalized.includes('archive.org') || normalized.includes('/download/')) return 'archive-library';

  return null;
}

function deriveChannelFromUrl(mediaUrl: string, guideId: string): string | null {
  const url = parseMediaUrl(mediaUrl);
  const source = (url?.hostname || '') + (url?.pathname || '');
  const normalized = source.toLowerCase();

  if (normalized.includes('alexjones.media')) return 'ajn-archive';
  if (normalized.includes('fox')) return 'fox-news';
  if (guideId === 'archive-library') return 'archive-library';

  return null;
}

function mediaFilename(mediaUrl: string): string {
  const url = parseMediaUrl(mediaUrl);
  const pathname = url?.pathname || mediaUrl.split(/[?#]/, 1)[0];
  const filename = pathname.split('/').filter(Boolean).pop() || '';
  try {
    return decodeURIComponent(filename).trim();
  } catch {
    return filename.trim();
  }
}

function dateSlug(input: PlaybackIdentityInput): string | null {
  const raw = input.publishedAt?.trim();
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

export function normalizePlaybackIdentity(
  input: PlaybackIdentityInput,
): PlaybackIdentity {
  const guideId = cleanCandidate(input.guideId) || deriveGuideFromUrl(input.mediaUrl);
  if (!guideId) {
    throw new IdentityResolutionError(
      'Failed to resolve canonical identity: guideId could not be derived from input metadata or mediaUrl',
      input,
    );
  }

  const channelId = cleanCandidate(input.channelId) || deriveChannelFromUrl(input.mediaUrl, guideId);
  if (!channelId) {
    throw new IdentityResolutionError(
      'Failed to resolve canonical identity: channelId could not be derived from input metadata or mediaUrl',
      input,
    );
  }

  const sourceId = cleanCandidate(input.sourceId) || 'src-' + slug(channelId);
  const titleId = slug(input.title) || 'untitled-program';
  const filenameSlug = slug(mediaFilename(input.mediaUrl));
  const publishedDate = dateSlug(input);
  const stableAssetKey = [filenameSlug || titleId, publishedDate].filter(Boolean).join('-');

  const assetId =
    cleanCandidate(input.assetId) ||
    'asset-' + slug(sourceId) + '-' + stableAssetKey;

  const programId =
    cleanCandidate(input.programId) ||
    'prog-' + slug(channelId) + '-' + stableAssetKey;

  return {
    guideId,
    channelId,
    sourceId,
    assetId,
    programId,
    titleId,
    playbackId: 'pb-' + programId,
    routeId: guideId + '/' + channelId + '/' + programId,
    archiveIdentifier: cleanCandidate(input.archiveIdentifier) || filenameSlug || stableAssetKey,
  };
}
