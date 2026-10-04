// Single client loader for the AJN resource feeds served by /api/ajn/resources (used by Home panel and Radio view).
import type { MediaType } from '../types';

export type AjnFeedId = 'Alex' | 'WarRoom' | 'SundayLive' | 'AJNHourlyVideo' | 'AJNHourlyAudio';
export interface AjnResource { id: AjnFeedId; name: string; htmlUrl: string; rssUrl: string; mediaType: MediaType }
export interface AjnResourceCatalog { source: string; resources: AjnResource[] }
export interface AjnFeedItem {
  id: string; title: string; description?: string; publishedAt?: string; url?: string; thumbnailUrl?: string; mediaType: MediaType; feedId: AjnFeedId;
}
export interface AjnFeedsResult { catalog: AjnResourceCatalog; items: AjnFeedItem[]; failures: number }

export function mediaTypeFromUrl(url: string, fallback: MediaType): MediaType {
  const normalized = url.split('?')[0].split('#')[0].toLowerCase();
  if (/\.(mp4|m4v|webm|mov|mkv|m3u8)$/.test(normalized)) return 'video';
  if (/\.(mp3|aac|m4a|ogg|oga|opus|wav|flac)$/.test(normalized)) return 'audio';
  return fallback;
}

/** Loads the catalog and every feed. Individual feed failures are counted, not hidden; a catalog failure throws. Callers handle abort. */
export async function loadAjnFeeds(signal: AbortSignal): Promise<AjnFeedsResult> {
  const catalogResponse = await fetch('/api/ajn/resources', { signal });
  if (!catalogResponse.ok) throw new Error(`Resource catalog HTTP ${catalogResponse.status}`);
  const catalog = (await catalogResponse.json()) as AjnResourceCatalog;
  const results = await Promise.allSettled(
    catalog.resources.map(async (resource) => {
      const response = await fetch(`/api/ajn/resources/${resource.id}`, { signal });
      if (!response.ok) throw new Error(`${resource.id} HTTP ${response.status}`);
      const feed = await response.json();
      return (feed.items || []) as AjnFeedItem[];
    })
  );
  const items = results
    .filter((r): r is PromiseFulfilledResult<AjnFeedItem[]> => r.status === 'fulfilled')
    .flatMap((r) => r.value)
    .filter((item) => item.url)
    .map((item) => ({ ...item, mediaType: mediaTypeFromUrl(item.url!, item.mediaType) }));
  return { catalog, items, failures: results.filter((r) => r.status === 'rejected').length };
}
