import { normalizeAjnFilename } from './src/utils/ajnTitleNormalizer.js';
import { buildEpgIdentity } from './src/utils/epgIdentity.js';

export type AjnFeedId = 'Alex' | 'WarRoom' | 'SundayLive' | 'AJNHourlyVideo' | 'AJNHourlyAudio';
export type AjnResourceKind = 'live' | 'hourly' | 'segment';

export interface AjnStreamLink {
  id: string;
  name: string;
  mediaType: 'audio';
  url: string;
  protocol: 'aac' | 'mp3' | 'opus';
}

export interface AjnAffiliateLink {
  id: string;
  name: string;
  url: string;
}

export interface AjnAudioIndex {
  id: 'mp3-hourly' | 'mp3-segs';
  name: string;
  url: string;
  mediaType: 'audio';
  kind: 'hourly' | 'segment';
}

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
  sourceId: string;
  programId: string;
  assetId: string;
  archiveIdentifier?: string;
}

const BASE = 'https://rss.alexjones.media';
const AUDIO_INDEX_FETCH_URLS: Record<AjnAudioIndex['kind'], string> = {
  hourly: 'https://www.alexjoneslive.com/affiliates/mp3-hourly/',
  segment: 'https://www.alexjoneslive.com/affiliates/mp3-segs/',
};
const RESOURCES: AjnResourceLink[] = [
  { id: 'Alex', name: 'The Alex Jones Show', mediaType: 'video', htmlUrl: `${BASE}/Alex.html`, rssUrl: `${BASE}/Alex.xml` },
  { id: 'WarRoom', name: 'War Room with Harrison Smith', mediaType: 'video', htmlUrl: `${BASE}/WarRoom.html`, rssUrl: `${BASE}/WarRoom.xml` },
  { id: 'SundayLive', name: 'Sunday Night Live', mediaType: 'video', htmlUrl: `${BASE}/SundayLive.html`, rssUrl: `${BASE}/SundayLive.xml` },
  { id: 'AJNHourlyVideo', name: 'Network Feed Hourly Video', mediaType: 'video', htmlUrl: `${BASE}/AJNHourlyVideo.html`, rssUrl: `${BASE}/AJNHourlyVideo.xml` },
  { id: 'AJNHourlyAudio', name: 'Network Feed Hourly Audio', mediaType: 'audio', htmlUrl: `${BASE}/AJNHourlyAudio.html`, rssUrl: `${BASE}/AJNHourlyAudio.xml` },
];

const STREAMS: AjnStreamLink[] = [
  { id: 'alex-aac', name: 'Alex Jones Show (AAC)', mediaType: 'audio', url: 'https://stream.alexjones.media/alexjonesshow', protocol: 'aac' },
  { id: 'alex-mp3', name: 'Alex Jones Show (MP3)', mediaType: 'audio', url: 'https://stream.alexjones.media/alexjonesshow.mp3', protocol: 'mp3' },
  { id: 'alex-opus', name: 'Alex Jones Show (OPUS)', mediaType: 'audio', url: 'https://audio.alexjoneslive.com:8443/alexjonesshow.opus', protocol: 'opus' },
  { id: 'alex-alt-aac', name: 'Alex Jones Show (alternate AAC)', mediaType: 'audio', url: 'https://audio.alexjoneslive.com:8443/alexjonesshow.aac', protocol: 'aac' },
  { id: 'warroom', name: 'War Room with Harrison Smith', mediaType: 'audio', url: 'https://stream.alexjones.media/warroom/', protocol: 'aac' },
  { id: 'network-aac', name: 'Network Feed - All Live Shows (AAC)', mediaType: 'audio', url: 'https://stream.alexjones.media/stream/7/', protocol: 'aac' },
  { id: 'alex-stream-1', name: 'Alex Jones Show Feed', mediaType: 'audio', url: 'https://stream.alexjones.media/stream/1/', protocol: 'aac' },
  { id: 'alex-stream-2', name: 'Alex Jones Show Feed (MP3)', mediaType: 'audio', url: 'https://stream.alexjones.media/stream/2/', protocol: 'mp3' },
  { id: 'warroom-stream-4', name: 'War Room Show Feed', mediaType: 'audio', url: 'https://stream.alexjones.media/stream/4/', protocol: 'aac' },
  { id: 'warroom-stream-6', name: 'War Room Show Feed (MP3)', mediaType: 'audio', url: 'https://stream.alexjones.media/stream/6/', protocol: 'mp3' },
  { id: 'network-stream-8', name: 'Network Stream (MP3)', mediaType: 'audio', url: 'https://stream.alexjones.media/stream/8/', protocol: 'mp3' },
];

const AUDIO_INDEXES: AjnAudioIndex[] = [
  { id: 'mp3-hourly', name: 'MP3 Hourly Files', url: `${BASE}/mp3-hourly.html`, mediaType: 'audio', kind: 'hourly' },
  { id: 'mp3-segs', name: 'MP3 Segment Files', url: `${BASE}/mp3-segs.html`, mediaType: 'audio', kind: 'segment' },
];

const AFFILIATES: AjnAffiliateLink[] = [
  { id: 'mp4-segs', name: 'MP4 Segment Files', url: `${BASE}/mp4-segs.html` },
  { id: 'mp3-hourly', name: 'MP3 Hourly Files', url: `${BASE}/mp3-hourly.html` },
  { id: 'mp3-segs', name: 'MP3 Segment Files', url: `${BASE}/mp3-segs.html` },
  { id: 'mp3-segs-legacy', name: 'MP3 Segment Files - Legacy', url: `${BASE}/mp3-segs-legacy.html` },
  { id: 'programming-clock', name: 'Affiliate Clock', url: `${BASE}/Programming-Clock.png` },
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

function attributeUrl(block: string, element: string): string | undefined {
  const re = new RegExp(`<${element}\\b[^>]*?url=["']([^"']+)["'][^>]*\\/?>(?:<\\/${element}>)?`, 'i');
  const m = block.match(re);
  return m?.[1] ? decodeXml(m[1]) : undefined;
}

function enclosureUrl(block: string): string | undefined {
  return attributeUrl(block, 'enclosure');
}

function mediaUrl(block: string): string | undefined {
  return enclosureUrl(block)
    || attributeUrl(block, 'media:content')
    || attributeUrl(block, 'media:player')
    || tag(block, 'link')
    || tag(block, 'guid');
}

function inferMediaType(url: string, fallback: 'video' | 'audio'): 'video' | 'audio' {
  const normalized = url.split('?')[0].split('#')[0].toLowerCase();
  if (/\.(mp4|m4v|webm|mov|mkv|m3u8)$/.test(normalized)) return 'video';
  if (/\.(mp3|aac|m4a|ogg|oga|opus|wav|flac)$/.test(normalized)) return 'audio';
  return fallback;
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

export function getAjnStreams(): AjnStreamLink[] {
  return STREAMS.map(stream => ({ ...stream }));
}

export function getAjnAffiliateLinks(): AjnAffiliateLink[] {
  return AFFILIATES.map(link => ({ ...link }));
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

  const items = [...xml.matchAll(/<item\\b[^>]*>([\\s\\S]*?)<\\/item>/gi)].map((match, index) => {
    const block = match[1];
    const url = mediaUrl(block);
    if (!url) return null;

    const title = tag(block, 'title') || `AJN ${resource.name}`;
    const guid = tag(block, 'guid');
    const identity = buildEpgIdentity({
      guideId: 'ajn-archive-special-feeds',
      channelId: `ajn-${id}`,
      sourceId: `src-ajn-${id.toLowerCase()}`,
      externalId: guid,
      title,
      mediaUrl: url,
    });

    return {
      id: itemId(id, block, index),
      feedId: id,
      title,
      url,
      mediaType: inferMediaType(url, resource.mediaType),
      publishedAt: tag(block, 'pubDate') || tag(block, 'dc:date'),
      description: tag(block, 'description'),
      duration: tag(block, 'itunes:duration'),
      thumbnailUrl: undefined,
      metadata: {
        guid: guid || '',
        author: tag(block, 'author') || tag(block, 'dc:creator') || '',
        sourceFeed: resource.rssUrl,
      },
      sourceId: identity.sourceId,
      programId: identity.programId,
      assetId: identity.assetId,
    } as AjnFeedItem;
  }).filter((item): item is AjnFeedItem => Boolean(item));

  return { resource, fetchedAt: new Date().toISOString(), items, rawBytes: Buffer.byteLength(xml, 'utf8') };
}


function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function parseAudioIndexUrl(href: string): string | undefined {
  const value = decodeHtml(href.trim());
  if (!/^https?:\/\//i.test(value)) return value ? new URL(value, BASE).toString() : undefined;
  return value;
}

function parseAudioIndexItems(html: string, index: AjnAudioIndex): AjnFeedItem[] {
  const records = new Map<string, AjnFeedItem>();
  const hrefRe = /href=["']([^"']+\.(?:mp3|m4a|aac|ogg|opus|wav)(?:[?#][^"']*)?)["']/gi;
  for (const match of html.matchAll(hrefRe)) {
    const url = parseAudioIndexUrl(match[1]);
    if (!url) continue;
    const filename = url.split('/').filter(Boolean).pop() || url;
    const title = normalizeAjnFilename(filename) || index.name;
    const id = `ajn:${index.kind}:${url}`;
    if (records.has(id)) continue;
    const identity = buildEpgIdentity({
      guideId: 'ajn-archive-special-feeds',
      channelId: `ajn-audio-${index.kind}`,
      sourceId: `src-ajn-hourly-audio-${index.kind}`,
      title,
      mediaUrl: url,
    });
    records.set(id, {
      id,
      feedId: 'AJNHourlyAudio',
      title: title || index.name,
      url,
      mediaType: 'audio',
      sourceId: identity.sourceId,
      programId: identity.programId,
      assetId: identity.assetId,
      metadata: {
        sourceIndex: index.url,
        resourceKind: index.kind,
        authoritative: 'true',
      },
    });
  }
  return [...records.values()];
}

export function getAjnAudioIndexes(): AjnAudioIndex[] {
  return AUDIO_INDEXES.map(index => ({ ...index }));
}

export async function fetchAjnAudioIndex(kind: 'hourly' | 'segment', signal?: AbortSignal): Promise<{ index: AjnAudioIndex; fetchedAt: string; items: AjnFeedItem[]; rawBytes: number }> {
  const index = AUDIO_INDEXES.find(item => item.kind === kind);
  if (!index) throw new Error(`Unknown AJN audio index: ${kind}`);
  const response = await fetch(AUDIO_INDEX_FETCH_URLS[kind], {
    signal,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; AJN-Precision-Engineering/1.0)',
      'Accept': 'text/html, application/xhtml+xml;q=0.9, */*;q=0.1',
      'Cache-Control': 'no-cache',
      'Referer': BASE + '/',
    },
  });
  if (!response.ok) throw new Error(`AJN audio index ${kind} returned HTTP ${response.status}`);
  const html = await response.text();
  const items = parseAudioIndexItems(html, index);
  return { index, fetchedAt: new Date().toISOString(), items, rawBytes: Buffer.byteLength(html, 'utf8') };
}
