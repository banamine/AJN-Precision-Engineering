import { classifyPublicationTime } from './retention';
export { CUBE_FRESHNESS_MS } from './retention';

export interface CubeArticle {
  id: string;
  title: string;
  summary: string;
  publisherName: string;
  publisherId: string;
  publishedAt: string | null;
  canonicalUrl: string;
  imageUrl: string | null;
  /** Reserved for a future feed extension. The v1 Daily News Digest adapter never sets this. */
  mediaReference?: { type: 'native' | 'hls' | 'embed'; src: string };
}

export interface CubeFaceAllocation {
  faceIndex: number;
  faceLabel: string;
  articles: (CubeArticle | null)[];
}

export interface CubeDropCounts {
  noDate: number;
  tooOld: number;
  fake: number;
  duplicate: number;
  invalid: number;
}

export interface CubeAdapterResult {
  articles: CubeArticle[];
  dropped: CubeDropCounts;
}

const MAX_TITLE = 300;
const MAX_SUMMARY = 900;
const TRACKING_PARAM = /^(utm_[a-z0-9_]+|fbclid|gclid|dclid|mc_cid|mc_eid|ref_src|igshid)$/i;

function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const text = value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, entity: string) => {
      if (entity[0] === '#') {
        const code = entity[1].toLowerCase() === 'x'
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
        return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      }
      return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[entity.toLowerCase()] ?? whole;
    })
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .normalize('NFC');
  return text.slice(0, max);
}

function safeHttpUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

export function normalizeCanonicalUrl(value: unknown): string | null {
  const url = safeHttpUrl(value);
  if (!url) return null;
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  }
  return url.toString();
}

function normalizedUrlKey(value: string): string {
  const url = new URL(value);
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
  return url.toString();
}

function isFakeFallback(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return (host === 'alexjoneslive.com' || host.endsWith('.alexjoneslive.com'))
    && /\/story-\d+(?:\/|$)/i.test(url.pathname);
}

function extractItems(raw: unknown): unknown[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const data = raw as Record<string, unknown>;
  return ['stories', 'rss_feeds_articles', 'scraped_articles']
    .flatMap((key) => Array.isArray(data[key]) ? data[key] as unknown[] : []);
}

export function toCubeArticles(raw: unknown, now: number = Date.now()): CubeAdapterResult {
  const dropped: CubeDropCounts = { noDate: 0, tooOld: 0, fake: 0, duplicate: 0, invalid: 0 };
  const accepted: Array<{ article: CubeArticle; sourceIndex: number; publishedMs: number }> = [];
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();

  for (const [sourceIndex, candidate] of extractItems(raw).entries()) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      dropped.invalid += 1;
      continue;
    }
    const item = candidate as Record<string, unknown>;
    const title = cleanText(item.headline ?? item.title, MAX_TITLE);
    const rawUrl = item.url ?? item.link;
    const canonicalUrl = normalizeCanonicalUrl(rawUrl);
    if (!title || !canonicalUrl) {
      dropped.invalid += 1;
      continue;
    }
    const url = new URL(canonicalUrl);
    if (isFakeFallback(url)) {
      dropped.fake += 1;
      continue;
    }

    const id = cleanText(item.id, 200) || canonicalUrl;
    const urlKey = normalizedUrlKey(canonicalUrl);
    if (seenIds.has(id) || seenUrls.has(urlKey)) {
      dropped.duplicate += 1;
      continue;
    }
    seenIds.add(id);
    seenUrls.add(urlKey);

    const publication = classifyPublicationTime(item.published, now);
    if (publication.kind === 'no-date') {
      dropped.noDate += 1;
      continue;
    }
    if (publication.kind === 'outside-window') {
      dropped.tooOld += 1;
      continue;
    }
    const { publishedMs } = publication;

    const image = safeHttpUrl(item.imageUrl);
    const imageUrl = image && image.protocol === 'https:'
      && !/(^|\.)images\.unsplash\.com$/i.test(image.hostname)
      ? image.toString()
      : null;
    const publisherName = cleanText(item.feedName ?? item.feed ?? item.sourceGroup ?? item.author, 120) || url.hostname;
    const publisherId = cleanText(item.feedId ?? item.sourceGroup, 160) || publisherName;
    accepted.push({
      sourceIndex,
      publishedMs,
      article: {
        id,
        title,
        summary: cleanText(item.excerpt ?? item.summary, MAX_SUMMARY),
        publisherName,
        publisherId,
        publishedAt: new Date(publishedMs).toISOString(),
        canonicalUrl,
        imageUrl,
      },
    });
  }

  accepted.sort((a, b) => b.publishedMs - a.publishedMs || a.sourceIndex - b.sourceIndex);
  return { articles: accepted.map(({ article }) => article), dropped };
}

export function allocateFaces(articles: readonly CubeArticle[]): CubeFaceAllocation[] {
  const slots: (CubeArticle | null)[] = Array.from({ length: 36 }, (_, index) => articles[index] ?? null);
  return Array.from({ length: 6 }, (_, faceIndex) => ({
    faceIndex,
    faceLabel: `Face ${faceIndex + 1}`,
    articles: slots.slice(faceIndex * 6, faceIndex * 6 + 6),
  }));
}

export function filterByPublisher(articles: readonly CubeArticle[], publisherId: string | null): CubeArticle[] {
  return publisherId ? articles.filter((article) => article.publisherId === publisherId) : [...articles];
}
