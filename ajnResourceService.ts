export type AjnFeedId = 'Alex' | 'WarRoom' | 'SundayLive' | 'AJNHourlyVideo' | 'AJNHourlyAudio';

export interface AjnResourceLink {
  id: AjnFeedId;
  name: string;
  mediaType: 'video' | 'audio';
  htmlUrl: string;
  rssUrl: string;
}

export interface AjnFeedItem {
  id: string;
  feedId: AjnFeedId;
  title: string;
  url: string;
  mediaType: 'video' | 'audio';
  publishedAt?: string;
  description?: string;
  duration?: string;
  thumbnailUrl?: string;
  metadata: Record<string, string>;
}

const BASE = 'https://rss.alexjones.media';
const RESOURCES: AjnResourceLink[] = [
  { id: 'Alex', name: 'The Alex Jones Show', mediaType: 'video', htmlUrl: `${BASE}/Alex.html`, rssUrl: `${BASE}/Alex.xml` },
  { id: 'WarRoom', name: 'War Room with Harrison Smith', mediaType: 'video', htmlUrl: `${BASE}/WarRoom.html`, rssUrl: `${BASE}/WarRoom.xml` },
  { id: 'SundayLive', name: 'Sunday Night Live', mediaType: 'video', htmlUrl: `${BASE}/SundayLive.html`, rssUrl: `${BASE}/SundayLive.xml` },
  { id: 'AJNHourlyVideo', name: 'Network Feed Hourly Video', mediaType: 'video', htmlUrl: `${BASE}/AJNHourlyVideo.html`, rssUrl: `${BASE}/AJNHourlyVideo.xml` },
  { id: 'AJNHourlyAudio', name: 'Network Feed Hourly Audio', mediaType: 'audio', htmlUrl: `${BASE}/AJNHourlyAudio.html`, rssUrl: `${BASE}/AJNHourlyAudio.xml` },
];

const byId = new Map(RESOURCES.map(r => [r.id, r]));
const entityMap: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => {
      if (entity.startsWith('#x')) return String.fromCodePoint(parseInt(entity.slice(2), 16));
      if (entity.startsWith('#')) return String.fromCodePoint(parseInt(entity.slice(1), 10));
      return entityMap[entity] || `&${entity};`;
    })
    .trim();
}

function tag(block: string, name: string): string | undefined {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
  const m = block.match(re);
  return m ? decodeXml(m[1].replace(/<[^>]+>/g, ' ')).replace(/\\s+/g, ' ').trim() : undefined;
}

function enclosureUrl(block: string): string | undefined {
  const m = block.match(/<enclosure\\b[^>]*?url=["']([^"']+)["'][^>]*\/?>(?:<\/enclosure>)?/i);
  return m?.[1] ? decodeXml(m[1]) : undefined;
}

function mediaUrl(block: string): string | undefined {
  return enclosureUrl(block)
    || tag(block, 'media:content')
    || tag(block, 'link')
    || tag(block, 'guid');
}

function itemId(feedId: AjnFeedId, block: string, index: number): string {
  const guid = tag(block, 'guid');
  if (guid) return `${feedId}:${guid}`;
  const title = tag(block, 'title') || 'item';
  return `${feedId}:${index}:${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

export function getAjnResources(): AjnResourceLink[] {
  return RESOURCES.map(resource => ({ ...resource }));
}

export function getAjnResource(id: string): AjnResourceLink | undefined {
  return byId.get(id as AjnFeedId);
}

export async function fetchAjnFeed(id: AjnFeedId, signal?: AbortSignal): Promise<{ resource: AjnResourceLink; fetchedAt: string; items: AjnFeedItem[]; rawBytes: number }> {
  const resource = byId.get(id);
  if (!resource) throw new Error(`Unknown AJN feed: ${id}`);

  const response = await fetch(resource.rssUrl, {
    signal,
    headers: {
      'User-Agent': 'AJN-Precision-Engineering/1.0',
      'Accept': 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1',
      'Cache-Control': 'no-cache',
    },
  });
  if (!response.ok) throw new Error(`AJN feed ${id} returned HTTP ${response.status}`);
  const xml = await response.text();
  if (!/<(?:rss|feed)\b/i.test(xml)) throw new Error(`AJN feed ${id} did not return RSS/XML`);

  const items = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match, index) => {
    const block = match[1];
    const url = mediaUrl(block);
    return {
      id: itemId(id, block, index),
      feedId: id,
      title: tag(block, 'title') || `AJN ${resource.name}`,
      url: url || '',
      mediaType: resource.mediaType,
      publishedAt: tag(block, 'pubDate') || tag(block, 'dc:date'),
      description: tag(block, 'description'),
      duration: tag(block, 'itunes:duration'),
      thumbnailUrl: undefined,
      metadata: {
        guid: tag(block, 'guid') || '',
        author: tag(block, 'author') || tag(block, 'dc:creator') || '',
        sourceFeed: resource.rssUrl,
      },
    } as AjnFeedItem;
  }).filter(item => item.url);

  return { resource, fetchedAt: new Date().toISOString(), items, rawBytes: Buffer.byteLength(xml, 'utf8') };
}
