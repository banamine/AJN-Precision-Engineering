// Daily News Digest (banamine/Daily-News-Digest-): pure parsing + freshness. No I/O, no clock unless passed in.
// Shared by the server (server/newsDigest.ts) and the Radio view. The digest is HEADLINES AND LINKS, never playable media.

export interface DigestItem { id: string; title: string; url: string; source: string; excerpt: string | null; publishedAt: string | null; imageUrl: string | null }
export interface BriefingBlock { headline: string; source: string | null; summary: string | null; theme: string | null }
export interface Digest {
  date: string | null;
  updatedAt: string | null;
  top: DigestItem[];
  bySource: Array<{ source: string; items: DigestItem[] }>;
  /** The digest's own written briefing (`raw_summary`), one block per story. Empty when the text does not match the expected shape. */
  briefing: BriefingBlock[];
}
export type DigestFreshness = 'fresh' | 'late' | 'stale' | 'unknown';

/** The Action is scheduled 06:00 UTC but commits land ~10:00-13:00 UTC; 30 h covers one missed morning window. */
export const DIGEST_FRESH_HOURS = 30;
export const DIGEST_LATE_HOURS = 54;

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };
export const decodeEntities = (value: string): string => value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
  if (body[0] === '#') { const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10); return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match; }
  return NAMED[body.toLowerCase()] ?? match;
});
const clean = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  let text = value.replace(/<[^>]*>/g, ' ');
  for (let pass = 0; pass < 4; pass++) { const next = decodeEntities(text); if (next === text) break; text = next; } // feeds are often double or triple encoded
  text = text.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
};
const httpsUrl = (value: unknown): string | null => {
  try { const url = new URL(String(value)); return url.protocol === 'https:' ? url.toString() : null; } catch { return null; }
};

function toItem(raw: Record<string, unknown>): DigestItem | null {
  const title = clean(raw.headline ?? raw.title, 300);
  const url = httpsUrl(raw.url ?? raw.link);
  if (!title || !url) return null; // a headline without a working https link is not shown
  const published = typeof raw.published === 'string' ? new Date(raw.published) : null;
  return {
    id: String(raw.id ?? url), title, url, source: clean(raw.feedName ?? raw.feed ?? raw.author, 80) ?? 'News',
    excerpt: clean(raw.excerpt ?? raw.summary, 400), publishedAt: published && !Number.isNaN(published.getTime()) ? published.toISOString() : null,
    imageUrl: httpsUrl(raw.imageUrl),
  };
}

/** `### headline` blocks with `**Source:**`, `**Summary:**`, `**Key Theme:**` lines. Anything that does not match yields no block, never invented text. */
export function parseBriefing(raw: unknown): BriefingBlock[] {
  if (typeof raw !== 'string') return [];
  const blocks: BriefingBlock[] = [];
  for (const part of raw.split(/^###\s+/m).slice(1)) {
    const lines = part.split('\n');
    const headline = clean(lines[0], 300);
    if (!headline) continue;
    const body = lines.slice(1).join('\n');
    const field = (label: string) => clean(new RegExp(`\\*\\*${label}:\\*\\*\\s*([\\s\\S]*?)(?=\\n\\s*\\*\\*[A-Za-z ]+:\\*\\*|$)`).exec(body)?.[1], 700);
    blocks.push({ headline, source: field('Source'), summary: field('Summary'), theme: field('Key Theme') });
  }
  return blocks;
}

export function parseNewsDigest(json: unknown): Digest {
  if (!json || typeof json !== 'object') throw new Error('news digest is not an object');
  const data = json as Record<string, unknown>;
  const list = (value: unknown) => (Array.isArray(value) ? value : []).map(entry => (entry && typeof entry === 'object' ? toItem(entry as Record<string, unknown>) : null)).filter((item): item is DigestItem => item !== null);
  const top = list(data.stories);
  const all = list(data.rss_feeds_articles);
  if (!top.length && !all.length) throw new Error('news digest had no usable stories');
  const groups = new Map<string, DigestItem[]>();
  for (const item of all.length ? all : top) groups.set(item.source, [...(groups.get(item.source) ?? []), item]);
  for (const items of groups.values()) items.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
  return {
    date: typeof data.date === 'string' ? data.date : null,
    updatedAt: typeof data.last_updated === 'string' ? data.last_updated : null,
    top: top.length ? top : all.slice(0, 8),
    bySource: [...groups.entries()].map(([source, items]) => ({ source, items })),
    briefing: parseBriefing(data.raw_summary),
  };
}

/** Age of the digest by ITS OWN `last_updated`, never by when we fetched it. */
export function digestAgeHours(updatedAt: string | null, nowMs: number): number | null {
  const stamp = Date.parse(updatedAt ?? '');
  return Number.isNaN(stamp) ? null : Math.max(0, (nowMs - stamp) / 3_600_000);
}
export function digestFreshness(updatedAt: string | null, nowMs: number): DigestFreshness {
  const age = digestAgeHours(updatedAt, nowMs);
  if (age === null) return 'unknown';
  return age < DIGEST_FRESH_HOURS ? 'fresh' : age < DIGEST_LATE_HOURS ? 'late' : 'stale';
}

export type DigestNoticeLevel = 'ok' | 'warn' | 'stale';
export function digestAgeLabel(hours: number): string {
  if (hours < 1) return 'under an hour ago';
  if (hours < 48) return `${Math.round(hours)} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}
/** The honest one-line status for the digest. `refreshError` is set when the server's last refresh failed and an older digest is being served. */
export function digestNotice(updatedAt: string | null, nowMs: number, refreshError: string | null = null): { level: DigestNoticeLevel; text: string } {
  const age = digestAgeHours(updatedAt, nowMs);
  const freshness = digestFreshness(updatedAt, nowMs);
  const ago = age === null ? '' : digestAgeLabel(age);
  let level: DigestNoticeLevel = 'ok';
  let text = `Updated ${ago}.`;
  if (freshness === 'late') { level = 'warn'; text = `Today's briefing has not been published yet. Showing the digest from ${ago}.`; }
  else if (freshness === 'stale') { level = 'stale'; text = `The digest was last updated ${ago}. Showing the last published briefing.`; }
  else if (freshness === 'unknown') { level = 'warn'; text = 'The digest has no update time.'; }
  if (refreshError) { if (level === 'ok') level = 'warn'; text += ` The latest refresh failed (${refreshError}); showing the last digest we loaded.`; }
  return { level, text };
}
