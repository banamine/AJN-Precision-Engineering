export interface EpgIdentityInput {
  guideId: string;
  channelId: string;
  sourceId?: string;
  programId?: string;
  assetId?: string;
  title: string;
  mediaUrl: string;
  archiveIdentifier?: string;
  externalId?: string;
  publishedAt?: string;
  startTime?: number | string;
  endTime?: number | string;
  tvgId?: string;
  tvgName?: string;
}

export interface EpgIdentity {
  sourceId: string;
  programId: string;
  assetId: string;
}

export class EpgIdentityResolutionError extends Error {
  constructor(message: string, public readonly input: EpgIdentityInput) {
    super(message);
    this.name = 'EpgIdentityResolutionError';
  }
}

function clean(value?: string): string | undefined {
  const normalized = value?.trim();
  if (!normalized || normalized.toLowerCase() === 'unknown') return undefined;
  return normalized;
}

function slug(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function stableUrl(value: string): string {
  try {
    const url = new URL(value, 'http://ajn.local');
    url.hash = '';
    url.searchParams.delete('start');
    url.searchParams.delete('end');
    return url.toString();
  } catch {
    return value.split(/[?#]/, 1)[0];
  }
}

function stableSourceId(input: EpgIdentityInput): string {
  const explicit = clean(input.sourceId);
  if (explicit) return explicit;

  const owner = clean(input.tvgId) || clean(input.tvgName) || clean(input.channelId);
  if (!owner) {
    throw new EpgIdentityResolutionError(
      'EPG sourceId could not be resolved from producer-owned channel/source metadata',
      input,
    );
  }

  return `src-${slug(input.guideId)}-${slug(owner)}`;
}

function stableProgramKey(input: EpgIdentityInput, sourceId: string): string {
  const authoritative =
    clean(input.programId) ||
    clean(input.externalId) ||
    clean(input.archiveIdentifier);

  if (authoritative) return authoritative;

  const keyParts = [
    slug(sourceId),
    slug(input.title),
    clean(input.publishedAt) ? slug(input.publishedAt!) : '',
    input.startTime === undefined ? '' : slug(String(input.startTime)),
    input.endTime === undefined ? '' : slug(String(input.endTime)),
    slug(stableUrl(input.mediaUrl)),
  ].filter(Boolean);

  if (keyParts.length === 0) {
    throw new EpgIdentityResolutionError(
      'EPG program has no stable identity inputs',
      input,
    );
  }

  return keyParts.join('|');
}

export function buildEpgIdentity(input: EpgIdentityInput): EpgIdentity {
  const guideId = clean(input.guideId);
  const channelId = clean(input.channelId);
  const title = clean(input.title);
  const mediaUrl = clean(input.mediaUrl);

  if (!guideId || !channelId || !title || !mediaUrl) {
    throw new EpgIdentityResolutionError(
      'EPG identity requires guideId, channelId, title, and mediaUrl',
      input,
    );
  }

  const sourceId = stableSourceId(input);
  const programKey = stableProgramKey(input, sourceId);
  const canonicalProgram =
    clean(input.programId) ||
    `prog-${slug(channelId)}-${slug(programKey)}`;

  const canonicalAsset =
    clean(input.assetId) ||
    `asset-${slug(sourceId)}-${slug(stableUrl(mediaUrl))}-${slug(programKey)}`;

  return {
    sourceId,
    programId: canonicalProgram,
    assetId: canonicalAsset,
  };
}
