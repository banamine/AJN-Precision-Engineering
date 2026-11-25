// Citizen Free Press source for the On Air news slide. Headlines, a short blurb and a hotlinked picture only; never media, never stored.
// Flow: the public RSS feed lists CFP posts (headline + time); each new post page names the outbound article; the article's own page gives
// a blurb and a picture (og: tags). CFP asks for a 60 s pause between requests (robots.txt Crawl-delay), so every request to CFP waits at
// least that long after the previous one, newest posts first. Only posts from the last 48 hours are kept. X, Rumble, YouTube and archive
// links are headline-only (nothing is fetched from them). A failed or blocked article page falls back to headline-only, never to made-up
// text. Every outbound fetch goes through safeFetch (https only, public hosts only, every redirect hop checked). Nothing empty is success.
import { safeFetch, readTextCapped, anyPublicHost, SafeFetchError } from './safeFetch';
import { parseRssItems, clean, type ExtraFeed } from './extraNews';

export const CFP_FEED: ExtraFeed = { id: 'cfp', source: 'Citizen Free Press', url: 'https://citizenfreepress.com/feed/' };
export const CFP_HOST = 'citizenfreepress.com';
export const CFP_MAX_AGE_MS = 48 * 3600_000;
export const CFP_CRAWL_DELAY_MS = 60_000;
export const CFP_POLL_MS = 30 * 60_000;
const FEED_ITEMS = 60;
const MAX_KEPT = 200;
const MAX_ATTEMPTS = 3;
const PAGE_BYTES = 400 * 1024;
const TIMEOUT_MS = 10_000;
const UA = { connection: 'close', 'user-agent': 'ajn-precision-engineering/news (headline reader)', accept: 'text/html,application/xhtml+xml,application/rss+xml,application/xml' };

export type Platform = 'x' | 'rumble' | 'youtube' | 'archive';
export interface CfpItem { id: string; title: string; url: string; outlet: string; publishedAt: string; image: string | null; blurb: string | null; headlineOnly: boolean; platform: Platform | null }
export interface CfpState { status: 'ok' | 'building' | 'error'; items: CfpItem[]; pending: number; error: string | null; fetchedAt: string | null }

const PLATFORM_HOSTS: Record<string, Platform> = { 'x.com': 'x', 'twitter.com': 'x', 't.co': 'x', 'rumble.com': 'rumble', 'youtube.com': 'youtube', 'm.youtube.com': 'youtube', 'youtu.be': 'youtube', 'archive.ph': 'archive', 'archive.is': 'archive', 'archive.today': 'archive', 'archive.md': 'archive' };
const OUTLETS: Record<string, string> = {
  'foxnews.com': 'FOX NEWS', 'nypost.com': 'NY POST', 'reuters.com': 'REUTERS', 'breitbart.com': 'BREITBART', 'wsj.com': 'WSJ', 'dailywire.com': 'DAILY WIRE',
  'theepochtimes.com': 'EPOCH TIMES', 'justthenews.com': 'JUST THE NEWS', 'dailymail.co.uk': 'DAILY MAIL', 'washingtonexaminer.com': 'WASH. EXAMINER',
  'washingtontimes.com': 'WASH. TIMES', 'nationalreview.com': 'NATIONAL REVIEW', 'dailycaller.com': 'DAILY CALLER', 'newsmax.com': 'NEWSMAX', 'thehill.com': 'THE HILL',
  'politico.com': 'POLITICO', 'nytimes.com': 'NY TIMES', 'washingtonpost.com': 'WASH. POST', 'cnn.com': 'CNN', 'nbcnews.com': 'NBC NEWS', 'apnews.com': 'AP NEWS',
  'bloomberg.com': 'BLOOMBERG', 'townhall.com': 'TOWNHALL', 'theblaze.com': 'THE BLAZE', 'thefederalist.com': 'THE FEDERALIST', 'zerohedge.com': 'ZEROHEDGE',
  'oann.com': 'OAN', 'finance.yahoo.com': 'YAHOO FINANCE', 'yahoo.com': 'YAHOO', 'bbc.com': 'BBC', 'bbc.co.uk': 'BBC', 'cbsnews.com': 'CBS NEWS', 'abcnews.go.com': 'ABC NEWS',
  'thegatewaypundit.com': 'GATEWAY PUNDIT', 'redstate.com': 'REDSTATE', 'pjmedia.com': 'PJ MEDIA', 'freebeacon.com': 'FREE BEACON', 'dailysignal.com': 'DAILY SIGNAL',
  'thepostmillennial.com': 'POST MILLENNIAL', 'westernjournal.com': 'WESTERN JOURNAL', 'reason.com': 'REASON', 'axios.com': 'AXIOS', 'usatoday.com': 'USA TODAY', 'rt.com': 'RT',
};
const TRACKING = /^(utm_|fbclid$|gclid$|mc_|ref$|ref_src$|cmpid$|ncid$|taid$|s$)/i;
const stripWww = (h: string): string => h.toLowerCase().replace(/^www\./, '');
const registrable = (h: string): string => { const p = stripWww(h).split('.'); return p.length > 2 && /^(co|com|org|net|gov)$/.test(p[p.length - 2]) ? p.slice(-3).join('.') : p.slice(-2).join('.'); };

/** One address for one article: lower-case host without www, no fragment, no tracking parameters, no trailing slash. Null when not an http(s) URL. */
export function canonicalUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    u.hash = ''; u.hostname = stripWww(u.hostname);
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.searchParams.sort();
    const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : '';
    return `${u.protocol}//${u.host}${path}${u.search}`;
  } catch { return null; }
}
export const platformOf = (url: string): Platform | null => { try { const h = stripWww(new URL(url).hostname); return PLATFORM_HOSTS[h] ?? PLATFORM_HOSTS[registrable(h)] ?? null; } catch { return null; } };
const PLATFORM_LABEL: Record<Platform, string> = { x: 'X', rumble: 'RUMBLE', youtube: 'YOUTUBE', archive: 'ARCHIVE' };
/** The outlet's own name: known site names first, then the page's og:site_name, then the site's domain. Never "Citizen Free Press" unless nothing else exists. */
export function outletName(url: string, siteName?: string | null): string {
  const pf = platformOf(url); if (pf) return PLATFORM_LABEL[pf];
  let host = ''; try { host = stripWww(new URL(url).hostname); } catch { return 'CITIZEN FREE PRESS'; }
  const known = OUTLETS[host] ?? OUTLETS[registrable(host)]; if (known) return known;
  const sn = siteName ? clean(siteName) : '';
  if (sn && sn.length <= 28) return sn.toUpperCase();
  const label = registrable(host).split('.')[0];
  return label ? label.toUpperCase() : 'CITIZEN FREE PRESS';
}

/** The outbound article address on a CFP post page ("Go To Article" link). */
export function extractExternalLink(html: string): string | null {
  const m = /<p\b[^>]*class="[^"]*\bexternal-link\b[^"]*"[^>]*>\s*<a\b[^>]*\bhref="([^"]+)"/i.exec(html);
  if (!m) return null;
  const href = clean(m[1]);
  return /^https?:\/\//i.test(href) ? href : null;
}

function metaContent(html: string, key: string): string | null {
  for (const tagM of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tagM)?.[1]?.toLowerCase();
    if (name !== key) continue;
    const c = /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(tagM);
    const v = c ? (c[1] ?? c[2] ?? '') : '';
    if (v.trim()) return v;
  }
  return null;
}
const cutWords = (s: string, max: number): string => { if (s.length <= max) return s; const c = s.slice(0, max); const i = c.lastIndexOf(' '); return `${(i > max * 0.6 ? c.slice(0, i) : c).replace(/[\s,;:.-]+$/, '')}…`; };
/** Blurb, picture and site name from an article page's own tags. The picture must be https (a relative address is resolved against the page). */
export function parseArticleMeta(html: string, pageUrl: string): { blurb: string | null; image: string | null; siteName: string | null } {
  const desc = clean(metaContent(html, 'og:description') ?? metaContent(html, 'description') ?? '');
  let image: string | null = null;
  const raw = metaContent(html, 'og:image') ?? metaContent(html, 'twitter:image');
  if (raw) { try { const u = new URL(clean(raw), pageUrl); if (u.protocol === 'https:' && u.href.length <= 600) image = u.href; } catch { /* no picture */ } }
  const site = clean(metaContent(html, 'og:site_name') ?? '');
  return { blurb: desc.length >= 20 ? cutWords(desc, 220) : null, image, siteName: site || null };
}

export interface CfpStoreOptions { fetchImpl?: typeof fetch; now?: () => number; sleep?: (ms: number) => Promise<void>; delayMs?: number; pollMs?: number }
interface Tracked { postUrl: string; title: string; publishedMs: number; attempts: number; retryAt: number; item: CfpItem | null; skipped: boolean }

export function createCfpStore(opts: CfpStoreOptions = {}) {
  const now = opts.now ?? Date.now; const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const delay = opts.delayMs ?? CFP_CRAWL_DELAY_MS; const poll = opts.pollMs ?? CFP_POLL_MS;
  const tracked = new Map<string, Tracked>();
  let lastCfpRequest = 0; let fetchedAt: string | null = null; let feedError: string | null = null; let feedOk = false; let running: Promise<void> | null = null; let lastPostError: string | null = null; let busy = false; let lastFeedAt = 0; let timer: ReturnType<typeof setTimeout> | null = null;

  async function waitTurn(): Promise<void> { if (lastCfpRequest > 0) { const wait = lastCfpRequest + delay - now(); if (wait > 0) await sleep(wait); } lastCfpRequest = now(); }

  async function readFeed(): Promise<void> {
    await waitTurn();
    try {
      const { res } = await safeFetch(CFP_FEED.url, { allow: (h) => h === CFP_HOST, timeoutMs: TIMEOUT_MS, fetchImpl: opts.fetchImpl, headers: UA });
      if (!res.ok) { await res.body?.cancel().catch(() => {}); throw new Error(`HTTP ${res.status}`); }
      const items = parseRssItems(await readTextCapped(res, 3 * 1024 * 1024), CFP_FEED, now(), FEED_ITEMS);
      if (!items.length) throw new Error('feed had no usable items');   // an empty result is a failure
      lastFeedAt = now(); feedOk = true; feedError = null; fetchedAt = new Date(now()).toISOString();
      for (const it of items) { const ms = Date.parse(it.publishedAt); if (now() - ms > CFP_MAX_AGE_MS) continue; if (!tracked.has(it.url)) tracked.set(it.url, { postUrl: it.url, title: it.title, publishedMs: ms, attempts: 0, retryAt: 0, item: null, skipped: false }); }
    } catch (e) { feedError = e instanceof SafeFetchError ? `${e.reason}: ${e.message}` : e instanceof Error ? e.message : String(e); }
  }

  async function enrich(t: Tracked): Promise<void> {
    t.attempts += 1;
    let outbound: string | null = null;
    try {
      await waitTurn();
      const { res } = await safeFetch(t.postUrl, { allow: (h) => h === CFP_HOST, timeoutMs: TIMEOUT_MS, fetchImpl: opts.fetchImpl, headers: UA });
      if (!res.ok) { await res.body?.cancel().catch(() => {}); throw new Error(`HTTP ${res.status}`); }
      outbound = extractExternalLink(await readTextCapped(res, PAGE_BYTES));
    } catch (e) { lastPostError = e instanceof SafeFetchError ? `${e.reason}: ${e.message}` : e instanceof Error ? e.message : String(e); t.retryAt = now() + poll; return; }                      // CFP page unavailable: try again at a later poll (max attempts)
    if (!outbound) { t.skipped = true; return; }                       // a post with no article link cannot open a source, so it is not shown
    const pf = platformOf(outbound); const canon = canonicalUrl(outbound) ?? outbound;
    const base: CfpItem = { id: `cfp:${canon}`, title: t.title, url: outbound, outlet: outletName(outbound), publishedAt: new Date(t.publishedMs).toISOString(), image: null, blurb: null, headlineOnly: true, platform: pf };
    if (pf || !/^https:\/\//i.test(outbound)) { t.item = base; return; }   // platforms and plain-http links: headline only, nothing fetched
    try {
      const { res, finalUrl } = await safeFetch(outbound, { allow: anyPublicHost, timeoutMs: TIMEOUT_MS, fetchImpl: opts.fetchImpl, headers: UA });
      const ct = res.headers.get('content-type') ?? '';
      if (!res.ok || !/html/i.test(ct)) { await res.body?.cancel().catch(() => {}); t.item = base; return; }   // 403 and the like: headline only
      const meta = parseArticleMeta(await readTextCapped(res, PAGE_BYTES), finalUrl.href);
      t.item = { ...base, outlet: outletName(outbound, meta.siteName), image: meta.image, blurb: meta.blurb, headlineOnly: !meta.image && !meta.blurb };
    } catch { t.item = base; }
  }

  function prune(): void {
    for (const [k, t] of tracked) if (now() - t.publishedMs > CFP_MAX_AGE_MS) tracked.delete(k);
    if (tracked.size > MAX_KEPT) for (const k of [...tracked.keys()].slice(0, tracked.size - MAX_KEPT)) tracked.delete(k);
  }
  async function runOnce(): Promise<void> {
    await readFeed();
    const todo = [...tracked.values()].filter((t) => !t.item && !t.skipped && t.attempts < MAX_ATTEMPTS && t.retryAt <= now()).sort((a, b) => b.publishedMs - a.publishedMs);
    for (const t of todo) await enrich(t);
    prune();
  }
  /** One polite unit of work, driven by an incoming request (Cloud Run only gives CPU while a request is open, so a background timer cannot be trusted).
   *  Does nothing unless the 60 s crawl gap has passed: re-reads the feed when it is older than the poll time, otherwise enriches the newest unread post. */
  async function step(): Promise<void> {
    if (busy || running) return;
    if (lastCfpRequest > 0 && now() - lastCfpRequest < delay) return;
    busy = true;
    try {
      if (!feedOk || now() - lastFeedAt >= poll) { await readFeed(); if (!feedOk) lastFeedAt = now(); prune(); return; }
      const t = [...tracked.values()].filter((x) => !x.item && !x.skipped && x.attempts < MAX_ATTEMPTS && x.retryAt <= now()).sort((a, b) => b.publishedMs - a.publishedMs)[0];
      if (t) await enrich(t);
      prune();
    } catch { /* one failed step never breaks the next */ } finally { busy = false; }
  }
  function ensureStarted(): void {
    if (running || timer) return;
    const loop = (): void => { running = runOnce().catch(() => {}).finally(() => { running = null; timer = setTimeout(loop, poll); timer.unref?.(); }); };
    loop();
  }
  function snapshot(): CfpState {
    const seen = new Set<string>(); const items: CfpItem[] = [];
    for (const t of [...tracked.values()].sort((a, b) => b.publishedMs - a.publishedMs)) {
      if (!t.item || now() - t.publishedMs > CFP_MAX_AGE_MS) continue;
      const c = canonicalUrl(t.item.url) ?? t.item.url; if (seen.has(c)) continue; seen.add(c); items.push(t.item);   // same article twice: keep the newest post
    }
    const pending = [...tracked.values()].filter((t) => !t.item && !t.skipped && t.attempts < MAX_ATTEMPTS).length;
    const status: CfpState['status'] = items.length ? 'ok' : feedError ? 'error' : feedOk && !pending ? 'ok' : 'building';
    return { status, items, pending, error: items.length ? null : (feedError ?? lastPostError), fetchedAt };
  }
  return { runOnce, step, ensureStarted, snapshot, get: (): CfpState => snapshot() };
}
const store = createCfpStore();
/** Called by the route on every request: does at most one polite step (awaited, so it finishes while the request is open), then returns the current state. */
export const getCfpNews = async (): Promise<CfpState> => { await store.step(); return store.get(); };
