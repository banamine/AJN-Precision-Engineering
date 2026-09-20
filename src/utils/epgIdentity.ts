const EPHEMERAL_QUERY_PARAMETERS = new Set([
  'token', 'access_token', 'auth', 'signature', 'sig', 'expires', 'exp',
  'session', 'session_id', 'timestamp', 'expires_at',
]);

export interface ChannelIdentityInput { externalId?: string | null; name?: string | null; guideId?: string | null; }
export interface SourceIdentityInput { channelId: string; url: string; protocol?: string | null; }
export interface ProgramIdentityInput { externalId?: string | null; channelId: string; title: string; startTime?: number | string | Date | null; }
export interface AssetIdentityInput { externalId?: string | null; programId?: string | null; archiveIdentifier?: string | null; mediaUrl?: string | null; }

function normalizeText(value: string | null | undefined): string {
  return String(value ?? '').trim().normalize('NFKC').replace(/\s+/g, ' ').toLowerCase();
}

function slug(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const byte of new TextEncoder().encode(value)) { hash ^= BigInt(byte); hash = (hash * prime) & mask; }
  return hash.toString(16).padStart(16, '0');
}

function stableId(namespace: string, value: string): string { return `${namespace}-${fnv1a64(value)}`; }

export function sanitizeIdentityUrl(rawUrl: string): string {
  const input = String(rawUrl ?? '').trim();
  if (!input) return '';
  try {
    const url = new URL(input, 'https://ajn.invalid');
    for (const key of Array.from(url.searchParams.keys())) if (EPHEMERAL_QUERY_PARAMETERS.has(key.toLowerCase())) url.searchParams.delete(key);
    const synthetic = url.origin === 'https://ajn.invalid';
    const authority = synthetic ? '' : url.origin;
    const query = url.searchParams.toString();
    return `${authority}${url.pathname}${query ? `?${query}` : ''}${url.hash}`;
  } catch {
    return input.replace(/([?&](?:token|access_token|auth|signature|sig|expires|exp|session|session_id|timestamp|expires_at))=[^&#]*/gi, '').replace(/[?&]+$/g, '').replace(/\?&/g, '?');
  }
}

export function normalizeChannelIdentity(input: ChannelIdentityInput): string {
  const externalId = slug(input.externalId ?? '');
  if (externalId) return `channel-${externalId}`;
  const guide = slug(input.guideId ?? '');
  const name = slug(input.name ?? '');
  if (!name) throw new Error('Channel identity requires externalId or name');
  return stableId('channel', `${guide}|${name}`);
}

export function normalizeSourceIdentity(input: SourceIdentityInput): string {
  const channelId = normalizeText(input.channelId);
  const normalizedUrl = sanitizeIdentityUrl(input.url);
  if (!channelId) throw new Error('Source identity requires channelId');
  if (!normalizedUrl) throw new Error('Source identity requires url');
  return stableId('source', [channelId, normalizeText(input.protocol), normalizedUrl].join('|'));
}

function normalizeUtcInstant(value: number | string | Date | null | undefined): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === 'number') { const d = new Date(value >= 1e12 ? value : value * 1000); return Number.isNaN(d.getTime()) ? null : d.toISOString(); }
  if (typeof value === 'string' && value.trim()) { const d = new Date(value); return Number.isNaN(d.getTime()) ? null : d.toISOString(); }
  return null;
}

export function normalizeProgramIdentity(input: ProgramIdentityInput): string {
  const externalId = normalizeText(input.externalId);
  if (externalId) return stableId('program', `external|${externalId}`);
  const channelId = normalizeText(input.channelId);
  const title = normalizeText(input.title);
  const startUtc = normalizeUtcInstant(input.startTime);
  if (!channelId) throw new Error('Program identity requires channelId');
  if (!title) throw new Error('Program identity requires title');
  if (!startUtc) throw new Error('Program identity requires startTime when externalId is absent');
  return stableId('program', `composite|${channelId}|${title}|${startUtc}`);
}

export function normalizeAssetIdentity(input: AssetIdentityInput): string {
  const externalId = normalizeText(input.externalId);
  if (externalId) return stableId('asset', `external|${externalId}`);
  const archiveIdentifier = normalizeText(input.archiveIdentifier);
  if (archiveIdentifier) return stableId('asset', `archive|${archiveIdentifier}`);
  const programId = normalizeText(input.programId);
  if (programId) return stableId('asset', `program|${programId}`);
  const mediaUrl = sanitizeIdentityUrl(input.mediaUrl ?? '');
  if (!mediaUrl) throw new Error('Asset identity requires externalId, archiveIdentifier, programId, or mediaUrl');
  return stableId('asset', `media|${mediaUrl}`);
}