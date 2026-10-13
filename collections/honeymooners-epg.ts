import { Program } from '../src/types';
import { normalizeProgramIdentity, normalizeAssetIdentity } from '../src/utils/epgIdentity';
import { HONEYMOONERS_COLLECTION, HONEYMOONERS_CHANNEL_ID, HONEYMOONERS_CHANNEL_NAME, type ArchiveCollectionItem } from './honeymooners-collection';

const ARCHIVE_BASE = 'https://archive.org';
const REQUEST_TIMEOUT_MS = 60000;

export interface HoneymoonersResolvedAsset {
  id: string;
  title: string;
  archiveIdentifier: string;
  mediaUrl: string;
  durationSeconds: number;
  quality: string;
}

interface ArchiveFile {
  name?: string;
  length?: number | string;
  duration?: number | string;
  width?: number | string;
}
interface ArchiveMetadata { files?: ArchiveFile[] }
interface ResolveOptions {
  collection?: readonly ArchiveCollectionItem[];
  loadMetadata?: (identifier: string) => Promise<ArchiveMetadata | null>;
}

// Case-sensitive code-unit lexical ordering, independent of locale/ICU.
const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const sourcePath = (identifier: string, name = '') =>
  `/download/${identifier}/${encodeURIComponent(name).replace(/%2F/g, '/')}`;
function compareSourceKeys(aPath: string, bPath: string, aName = '', bName = '', aId = '', bId = '') {
  return lexical(aPath, bPath) || lexical(aName, bName) || lexical(aId, bId);
}
const fileName = (path: string) => decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
const compareAssets = (a: HoneymoonersResolvedAsset, b: HoneymoonersResolvedAsset) =>
  compareSourceKeys(a.mediaUrl, b.mediaUrl, fileName(a.mediaUrl), fileName(b.mediaUrl), a.id, b.id);

async function fetchMetadata(identifier: string): Promise<ArchiveMetadata | null> {
  try {
    const response = await fetch(`${ARCHIVE_BASE}/metadata/${encodeURIComponent(identifier)}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'AJN-Precision-Engineering/1.0' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function durationSeconds(file: ArchiveFile): number {
  const value = Number(file?.length ?? file?.duration ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function quality(fileName: string, file: ArchiveFile): string {
  const lower = fileName.toLowerCase();
  const width = Number(file?.width ?? 0);
  if (lower.includes('4k') || width >= 3840) return '4K';
  if (lower.includes('1080') || width >= 1920) return 'HD';
  if (lower.includes('720') || width >= 1280) return 'HD';
  return 'SD';
}

export async function resolveHoneymoonersAssets(options: ResolveOptions = {}): Promise<HoneymoonersResolvedAsset[]> {
  const assets: HoneymoonersResolvedAsset[] = [];
  const loadMetadata = options.loadMetadata ?? fetchMetadata;
  // Sort collection candidates BEFORE launching any network worker.
  const collection = [...(options.collection ?? HONEYMOONERS_COLLECTION)].sort((a, b) =>
    compareSourceKeys(sourcePath(a.archiveIdentifier), sourcePath(b.archiveIdentifier), '', '', a.id, b.id));
  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, collection.length) }, async () => {
    while (cursor < collection.length) {
      const item = collection[cursor++];
      const metadata = await loadMetadata(item.archiveIdentifier);
      if (!metadata || !Array.isArray(metadata.files)) continue;
      const candidates = metadata.files
        .map(file => ({ file, name: String(file?.name ?? '') }))
        .filter(({ name }) => /\.(mp4|m4v)$/i.test(name))
        .sort((a, b) => {
          const aDuration = durationSeconds(a.file);
          const bDuration = durationSeconds(b.file);
          return bDuration - aDuration || compareSourceKeys(
            sourcePath(item.archiveIdentifier, a.name), sourcePath(item.archiveIdentifier, b.name), a.name, b.name);
        });
      const selected = candidates[0];
      if (!selected) continue;
      const duration = durationSeconds(selected.file);
      if (duration <= 0) continue;
      assets.push({
        id: `asset-${item.id}`,
        title: item.title,
        archiveIdentifier: item.archiveIdentifier,
        mediaUrl: sourcePath(item.archiveIdentifier, selected.name),
        durationSeconds: duration,
        quality: quality(selected.name, selected.file),
      });
    }
  });
  await Promise.all(workers);
  // Completion order and duplicate winner must never depend on worker timing.
  const seen = new Set<string>();
  return assets.sort(compareAssets).filter(asset => {
    if (seen.has(asset.mediaUrl)) return false;
    seen.add(asset.mediaUrl);
    return true;
  });
}

export async function buildHoneymoonersEpg(resolvedAssets?: HoneymoonersResolvedAsset[], now = new Date()) {
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  // Also sort injected fixtures; never mutate the caller's array.
  const assets = [...(resolvedAssets ?? await resolveHoneymoonersAssets())].sort(compareAssets);
  const secondsInDay = 24 * 3600;
  const programs: Program[] = [];
  let currentSecond = 0;
  let index = 0;

  while (assets.length > 0 && currentSecond < secondsInDay) {
    const asset = assets[index % assets.length];
    const endSecond = Math.min(secondsInDay, currentSecond + asset.durationSeconds);
    programs.push({
      id: normalizeProgramIdentity({
        externalId: `${asset.archiveIdentifier}|slot:${currentSecond}`,
        channelId: HONEYMOONERS_CHANNEL_ID,
        title: asset.title,
        startTime: currentSecond,
      }),
      guideId: 'classic-tv',
      channelId: HONEYMOONERS_CHANNEL_ID,
      title: asset.title,
      description: `Archive.org collection item: ${asset.archiveIdentifier}`,
      startTime: currentSecond / 3600,
      endTime: endSecond / 3600,
      startTimeUtc: new Date(dayStart + currentSecond * 1000).toISOString(),
      endTimeUtc: new Date(dayStart + endSecond * 1000).toISOString(),
      startHour: currentSecond / 3600,
      endHour: endSecond / 3600,
      mediaType: 'video',
      assetId: normalizeAssetIdentity({ externalId: asset.archiveIdentifier, mediaUrl: asset.mediaUrl }),
      mediaUrl: asset.mediaUrl,
      archivePath: asset.mediaUrl,
      metadata: {
        externalId: asset.archiveIdentifier,
        archiveIdentifier: asset.archiveIdentifier,
        assetId: normalizeAssetIdentity({ externalId: asset.archiveIdentifier, mediaUrl: asset.mediaUrl }),
        quality: asset.quality,
        durationSeconds: asset.durationSeconds,
        collectionId: 'honeymooners',
      },
    });
    currentSecond = endSecond;
    index += 1;
    if (asset.durationSeconds <= 0) break;
  }

  return {
    id: HONEYMOONERS_CHANNEL_ID,
    guideId: 'classic-tv',
    name: HONEYMOONERS_CHANNEL_NAME,
    mediaType: 'video' as const,
    group: 'Classic TV',
    programs,
    assetCount: assets.length,
    manifestItemCount: HONEYMOONERS_COLLECTION.length,
  };
}
