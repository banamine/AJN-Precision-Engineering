// Extra news headlines for the On Air page: public RSS feeds from the Conservative Ledger site list (checked 2026-11-25).
// Headlines and links only, never media. Each feed is fetched on the server, only that feed's own host is contacted (every redirect hop is
// checked by safeFetch), the newest few items are kept in memory, and the last good list per feed survives a failure. A failing feed
// is reported by name; an empty result is never counted as success. Fetched separately from the Daily News Digest, whose own pipeline is untouched.
import { safeFetch, readTextCapped, SafeFetchError } from './safeFetch';

export interface ExtraFeed { id: string; source: string; url: string }
export const EXTRA_FEEDS: readonly ExtraFeed[] = [
  { id: 'breitbart', source: 'Breitbart', url: 'https://feeds.feedburner.com/breitbart' },
  { id: 'post-millennial', source: 'The Post Millennial', url: 'https://thepostmillennial.com/feed' },
  { id: 'western-journal', source: 'Western Journal', url: 'https://www.westernjournal.com/feed/' },
  { id: 'pj-media', source: 'PJ Media', url: 'https://pjmedia.com/feed' },
  { id: 'the-dispatch', source: 'The Dispatch', url: 'https://thedispatch.com/feed/' },
  { id: 'reason', source: 'Reason', url: 'https://reason.com/feed/' },
  { id: 'free-beacon', source: 'Washington Free Beacon', url: 'https://freebeacon.com/feed/' },
  { id: 'redstate', source: 'RedState', url: 'https://redstate.com/feed' },
  { id: 'national-review', source: 'National Review', url: 'https://www.nationalreview.com/feed/' },
  { id: 'just-the-news', source: 'Just the News', url: 'https://justthenews.com/rss.xml' },
  { id: 'daily-signal', source: 'The Daily Signal', url: 'https://www.dailysignal.com/feed/' },
  { id: 'daily-caller', source: 'Daily Caller', url: 'https://dailycaller.com/feed/' },
  { id: 'daily-wire', source: 'The Daily Wire', url: 'https://www.dailywire.com/feeds/rss.xml' },
];
export const EXTRA_ITEMS_PER_FEED = 8;
export const EXTRA_TTL_MS = 15 * 60_000;
export const EXTRA_FAILURE_RETRY_MS = 2 * 60_000;
const FEED_TIMEOUT_MS = 12_000;
const FEED_MAX_BYTES = 3 * 1024 * 1024;
const CONCURRENCY = 4;

export interface ExtraItem { id: string; title: string; url: string; source: string; publishedAt: string }
export interface ExtraFeedStatus { id: string; source: string; ok: boolean; items: number; error: string | null }
export interface ExtraNewsState { items: ExtraItem[]; feeds: ExtraFeedStatus[]; fetchedAt: string | null }

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"', hellip: '...' };
function decode(s: string): string {
  const once = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  return once.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return ENT[e.toLowerCase()] ?? m;
  });
}
function tag(block: string, name: string): string | undefined {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? m[1].trim() : undefined;
}
export const clean = (s: string): string => decode(decode(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const hash = (s: string): string => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };

/** Parse RSS 2.0 `<item>` blocks. Items without a title, an https link or a valid, not-future date are dropped (no invented dates). Newest first. */
export function parseRssItems(xml: string, feed: ExtraFeed, nowMs: number, limit = EXTRA_ITEMS_PER_FEED): ExtraItem[] {
  const out: ExtraItem[] = []; const seen = new Set<string>();
  for (const block of xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? []) {
    const title = clean(tag(block, 'title') ?? '');
    const link = clean(tag(block, 'link') ?? tag(block, 'guid') ?? '');
    const when = Date.parse(clean(tag(block, 'pubDate') ?? tag(block, 'dc:date') ?? ''));
    if (!title || !/^https:\/\//i.test(link) || !Number.isFinite(when) || when > nowMs + 3600_000) continue;
    const id = `${feed.id}:${hash(link)}`; if (seen.has(id)) continue; seen.add(id);
    out.push({ id, title, url: link, source: feed.source, publishedAt: new Date(when).toISOString() });
  }
  return out.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, limit);
}

const describe = (e: unknown): string => e instanceof SafeFetchError ? `${e.reason}: ${e.message}` : e instanceof Error ? e.message : String(e);
export interface ExtraStoreOptions { feeds?: readonly ExtraFeed[]; fetchImpl?: typeof fetch; now?: () => number; ttlMs?: number; failureRetryMs?: number }

export function createExtraNewsStore(opts: ExtraStoreOptions = {}) {
  const feeds = opts.feeds ?? EXTRA_FEEDS; const now = opts.now ?? Date.now;
  const ttl = opts.ttlMs ?? EXTRA_TTL_MS; const failRetry = opts.failureRetryMs ?? EXTRA_FAILURE_RETRY_MS;
  const lastGood = new Map<string, ExtraItem[]>(); const status = new Map<string, ExtraFeedStatus>();
  let fetchedAt: string | null = null; let lastAttempt = 0; let anyFailed = false; let inflight: Promise<void> | null = null;

  async function one(feed: ExtraFeed): Promise<void> {
    try {
      const url = new URL(feed.url);
      const { res } = await safeFetch(url, { allow: (h) => h === url.hostname, timeoutMs: FEED_TIMEOUT_MS, fetchImpl: opts.fetchImpl, headers: { 'user-agent': 'ajn-precision-engineering/news', accept: 'application/rss+xml, application/xml, text/xml' } });
      if (!res.ok) { await res.body?.cancel().catch(() => {}); throw new Error(`HTTP ${res.status}`); }
      const items = parseRssItems(await readTextCapped(res, FEED_MAX_BYTES), feed, now());
      if (!items.length) throw new Error('feed had no usable items');   // an empty result is a failure, never success
      lastGood.set(feed.id, items); status.set(feed.id, { id: feed.id, source: feed.source, ok: true, items: items.length, error: null });
    } catch (e) {
      status.set(feed.id, { id: feed.id, source: feed.source, ok: false, items: lastGood.get(feed.id)?.length ?? 0, error: describe(e) }); // keep last good
    }
  }
  async function refresh(): Promise<void> {
    lastAttempt = now(); const queue = [...feeds];
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => { for (let f = queue.shift(); f; f = queue.shift()) await one(f); }));
    anyFailed = [...status.values()].some((s) => !s.ok);
    if ([...status.values()].some((s) => s.ok)) fetchedAt = new Date(now()).toISOString();
  }
  async function get(force = false): Promise<ExtraNewsState> {
    const age = now() - lastAttempt; const fresh = lastAttempt > 0 && age < (anyFailed ? failRetry : ttl);
    if (force || !fresh) { inflight ??= refresh().finally(() => { inflight = null; }); await inflight; }
    const items = [...lastGood.values()].flat().sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    return { items, feeds: feeds.map((f) => status.get(f.id) ?? { id: f.id, source: f.source, ok: false, items: 0, error: 'not fetched yet' }), fetchedAt };
  }
  return { get };
}
const store = createExtraNewsStore();
export const getExtraNews = (): Promise<ExtraNewsState> => store.get();
