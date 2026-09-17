import { Program } from '../src/types';
import { HONEYMOONERS_COLLECTION, HONEYMOONERS_CHANNEL_ID, HONEYMOONERS_CHANNEL_NAME } from './honeymooners-collection';

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

async function fetchMetadata(identifier: string): Promise<any | null> {
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

function durationSeconds(file: any): number {
  const value = Number(file?.length ?? file?.duration ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function quality(fileName: string, file: any): string {
  const lower = fileName.toLowerCase();
  const width = Number(file?.width ?? 0);
  if (lower.includes('4k') || width >= 3840) return '4K';
  if (lower.includes('1080') || width >= 1920) return 'HD';
  if (lower.includes('720') || width >= 1280) return 'HD';
  return 'SD';
}

export async function resolveHoneymoonersAssets(): Promise<HoneymoonersResolvedAsset[]> {
  const assets: HoneymoonersResolvedAsset[] = [];
  const seen = new Set<string>();
  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, HONEYMOONERS_COLLECTION.length) }, async () => {
    while (cursor < HONEYMOONERS_COLLECTION.length) {
      const item = HONEYMOONERS_COLLECTION[cursor++];
      const metadata = await fetchMetadata(item.archiveIdentifier);
      if (!metadata || !Array.isArray(metadata.files)) continue;
      const candidates = metadata.files
        .map((file: any) => ({ file, name: String(file?.name ?? '') }))
        .filter(({ name }: { name: string }) => /\.(mp4|m4v)$/i.test(name))
        .sort((a: { file: any; name: string }, b: { file: any; name: string }) => {
          const aDuration = durationSeconds(a.file);
          const bDuration = durationSeconds(b.file);
          return bDuration - aDuration;
        });
      const selected = candidates[0];
      if (!selected) continue;
      const duration = durationSeconds(selected.file);
      if (duration <= 0) continue;
      const identity = `${item.archiveIdentifier}|${selected.name}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      assets.push({
        id: `asset-${item.id}`,
        title: item.title,
        archiveIdentifier: item.archiveIdentifier,
        mediaUrl: `/download/${item.archiveIdentifier}/${encodeURIComponent(selected.name).replace(/%2F/g, '/')}`,
        durationSeconds: duration,
        quality: quality(selected.name, selected.file),
      });
    }
  });
  await Promise.all(workers);
  return assets;
}

export async function buildHoneymoonersEpg() {
  const assets = await resolveHoneymoonersAssets();
  const secondsInDay = 24 * 3600;
  const programs: Program[] = [];
  let currentSecond = 0;
  let index = 0;

  while (assets.length > 0 && currentSecond < secondsInDay) {
    const asset = assets[index % assets.length];
    const endSecond = Math.min(secondsInDay, currentSecond + asset.durationSeconds);
    programs.push({
      id: `${HONEYMOONERS_CHANNEL_ID}-${programs.length + 1}`,
      guideId: 'classic-tv',
      channelId: HONEYMOONERS_CHANNEL_ID,
      title: asset.title,
      description: `Archive.org collection item: ${asset.archiveIdentifier}`,
      startTime: currentSecond / 3600,
      endTime: endSecond / 3600,
      startHour: currentSecond / 3600,
      endHour: endSecond / 3600,
      mediaType: 'video',
      mediaUrl: asset.mediaUrl,
      archivePath: asset.mediaUrl,
      metadata: {
        archiveIdentifier: asset.archiveIdentifier,
        assetId: asset.id,
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
