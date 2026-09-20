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
  startTimeUtc?: number;
  endTimeUtc?: number;
  tvgId?: string;
  tvgName?: string;
}

export interface EpgIdentity {
  sourceId: string;
  programId: string;
  assetId: string;
}

export interface EpgIdentityWithTransport extends EpgIdentity {
  mediaUrl: string;
}

export class EpgIdentityResolutionError extends Error {
  constructor(message: string, public readonly input: EpgIdentityInput) {
    super(message);
    this.name = 'EpgIdentityResolutionError';
  }
}

function clean(value?: string): string | undefined {
  const normalized = value?.normalize('NFC').trim();
  if (!normalized || normalized.toLowerCase() === 'unknown') return undefined;
  return normalized;
}

function slug(value: string): string {
  return clean(value)?.toLocaleLowerCase('en-US')
    .replace(/(?:\(|\[)\s*(?:hd|uhd|fhd|sd|re[- ]?run|repeat)\s*(?:\)|\])\s*$/i, '')
    .replace(/\bs(\d{1,2})\s*e(\d{1,2})\b/gi, 's$1e$2')
    .replace(/\b(\d{1,2})x(\d{1,2})\b/gi, 's$1e$2')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '') || '';
}

function normalizeProgramTitle(value: string): string {
  return clean(value)
    ?.replace(/(?:\(|\[)\s*(?:hd|uhd|fhd|sd|re[- ]?run|repeat)\s*(?:\)|\])\s*/gi, ' ')
    .replace(/\b(\d{1,2})x(\d{1,2})\b/gi, 'S$1E$2')
    .replace(/\bs(\d{1,2})\s*e(\d{1,2})\b/gi, 'S$1E$2')
    .replace(/\s+/g, ' ')
    .trim() || '';
}

const VOLATILE_QUERY_KEYS = new Set([
  'token', 'start', 'end', 'expires', 'expiry', 'signature', 'sig', 'auth', 'hdnts',
]);

function normalizeAssetPath(value: string): string {
  try {
    const url = new URL(value, 'http://ajn.local');
    const path = decodeURIComponent(url.pathname)
      .replace(/\/+/g, '/')
      .replace(/\/\.\//g, '/')
      .replace(/\/[^/]+\/\.\.\//g, '/');

    const semanticQuery = Array.from(url.searchParams.entries())
      .filter(([key]) => !VOLATILE_QUERY_KEYS.has(key.toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => `${key.toLowerCase()}=${val.normalize('NFC')}`)
      .join('&');

    return semanticQuery
      ? `${path.toLocaleLowerCase('en-US')}?${semanticQuery}`
      : path.toLocaleLowerCase('en-US');
  } catch {
    return value.split(/[?#]/, 1)[0].normalize('NFC').trim().toLocaleLowerCase('en-US');
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

function requireUtcWindow(input: EpgIdentityInput): string[] {
  const hasStart = input.startTimeUtc !== undefined;
  const hasEnd = input.endTimeUtc !== undefined;
  if (!hasStart && !hasEnd) return [];
  if (!hasStart || !hasEnd || !Number.isSafeInteger(input.startTimeUtc) || !Number.isSafeInteger(input.endTimeUtc)) {
    throw new EpgIdentityResolutionError(
      'EPG schedule timestamps must be supplied as integer Unix epoch milliseconds in UTC',
      input,
    );
  }
  if (input.startTimeUtc! >= input.endTimeUtc!) {
    throw new EpgIdentityResolutionError(
      'EPG schedule startTimeUtc must be earlier than endTimeUtc',
      input,
    );
  }
  return [String(input.startTimeUtc), String(input.endTimeUtc)];
}

function stableProgramKey(input: EpgIdentityInput, sourceId: string): string {
  const authoritative = clean(input.programId) || clean(input.externalId) || clean(input.archiveIdentifier);
  if (authoritative) return authoritative;

  const time = requireUtcWindow(input);
  const keyParts = [
    slug(sourceId),
    slug(normalizeProgramTitle(input.title)),
    ...time,
  ].filter(Boolean);

  if (!time.length) {
    keyParts.push(slug(normalizeAssetPath(input.mediaUrl)));
  }

  if (keyParts.length === 0) {
    throw new EpgIdentityResolutionError('EPG program has no stable identity inputs', input);
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

  const programId = clean(input.programId) || `prog-${slug(channelId)}-${slug(programKey)}`;
  const normalizedPath = normalizeAssetPath(mediaUrl);
  const genericLive = /\/(?:live(?:\.[a-z0-9]+)?|stream(?:\.[a-z0-9]+)?|index(?:\.[a-z0-9]+)?)$/i.test(normalizedPath) ||
    /\.(?:m3u8|mpd)$/i.test(normalizedPath);
  const liveNamespace = genericLive ? `${sourceId}:${slug(channelId)}` : '';
  const assetKey = clean(input.assetId) || clean(input.archiveIdentifier) ||
    (genericLive ? `${liveNamespace}:${normalizedPath}` : normalizedPath);
  const assetId = clean(input.assetId) || `asset-${slug(assetKey)}`;

  return { sourceId, programId, assetId };
}
