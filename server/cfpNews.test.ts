import assert from 'node:assert';
import { createCfpStore, canonicalUrl, extractExternalLink, parseArticleMeta, outletName, platformOf, CFP_CRAWL_DELAY_MS } from './cfpNews';
let T = Date.parse('2026-11-25T12:00:00Z');
const hoursAgo = (h: number) => new Date(T - h * 3600_000).toUTCString();
const rssItem = (t: string, slug: string, h: number) => `<item><title>${t}</title><link>https://citizenfreepress.com/breaking/${slug}/</link><pubDate>${hoursAgo(h)}</pubDate></item>`;
const post = (href: string | null) => `<html><body><p class="external-link">${href ? `<a href="${href}" target="_blank">Go To Article -- x</a>` : ''}</p></body></html>`;
const article = (extra: string) => `<html><head>${extra}</head><body></body></html>`;
const html = (b: string, status = 200, ct = 'text/html; charset=utf-8') => new Response(b, { status, headers: { 'content-type': ct } });

// pure helpers
assert.equal(canonicalUrl('https://www.Example.com/a/b/?utm_source=x&b=2&a=1#frag'), 'https://example.com/a/b?a=1&b=2');
assert.equal(canonicalUrl('javascript:alert(1)'), null);
assert.equal(extractExternalLink(post('https://foxnews.com/politics/x')), 'https://foxnews.com/politics/x');
assert.equal(extractExternalLink(post('javascript:alert(1)')), null);
assert.equal(extractExternalLink('<p>no link</p>'), null);
assert.equal(platformOf('https://twitter.com/a/status/1'), 'x'); assert.equal(platformOf('https://www.youtube.com/watch?v=1'), 'youtube'); assert.equal(platformOf('https://foxnews.com/a'), null);
assert.equal(outletName('https://www.foxnews.com/a'), 'FOX NEWS'); assert.equal(outletName('https://some-paper.co.uk/a', 'The Some Paper'), 'THE SOME PAPER'); assert.equal(outletName('https://zzz.example.org/a'), 'EXAMPLE');
const meta = parseArticleMeta(article('<meta property="og:description" content="Crews will work through mid-December &amp; clear the backlog at the terminals."><meta content="/img/a.jpg" property="og:image"><meta property="og:site_name" content="Test Wire">'), 'https://t.example.com/story/1');
assert.equal(meta.image, 'https://t.example.com/img/a.jpg'); assert.match(meta.blurb ?? '', /^Crews will work through mid-December & clear/); assert.equal(meta.siteName, 'Test Wire');
assert.equal(parseArticleMeta(article('<meta property="og:image" content="http://insecure.example/a.jpg">'), 'https://t.example.com/').image, null, 'http picture refused');
assert.equal(parseArticleMeta(article('<meta property="og:description" content="short">'), 'https://t.example.com/').blurb, null);

(async () => {
  const log: string[] = []; const stamps: number[] = []; let feedXml = '';
  const pages: Record<string, () => Response> = {
    'https://citizenfreepress.com/feed/': () => html(feedXml, 200, 'application/rss+xml'),
    'https://citizenfreepress.com/breaking/fox/': () => html(post('https://www.foxnews.com/world/story?utm_source=cfp')),
    'https://citizenfreepress.com/breaking/xpost/': () => html(post('https://x.com/someone/status/123')),
    'https://citizenfreepress.com/breaking/blocked/': () => html(post('https://blocked.example.com/story')),
    'https://citizenfreepress.com/breaking/nolink/': () => html(post(null)),
    'https://citizenfreepress.com/breaking/old/': () => html(post('https://old.example.com/story')),
    'https://citizenfreepress.com/breaking/dupe/': () => html(post('https://foxnews.com/world/story')),
    'https://www.foxnews.com/world/story?utm_source=cfp': () => html(article('<meta property="og:description" content="Officials said the new measures take effect on Monday morning across all regions."><meta property="og:image" content="https://static.foxnews.com/a.jpg">')),
    'https://foxnews.com/world/story': () => html(article('<meta property="og:description" content="Officials said the new measures take effect on Monday morning across all regions.">')),
    'https://blocked.example.com/story': () => html('forbidden', 403),
  };
  const fetchImpl = (async (u: URL | string) => { const k = String(u); log.push(k); if (k.startsWith('https://citizenfreepress.com')) stamps.push(T); const p = pages[k]; return p ? p() : new Response('missing', { status: 404 }); }) as unknown as typeof fetch;
  const sleep = async (ms: number) => { T += ms; };
  feedXml = `<rss><channel>${rssItem('Fox story headline', 'fox', 1)}${rssItem('Post from X', 'xpost', 2)}${rssItem('Blocked site headline', 'blocked', 3)}${rssItem('No link here', 'nolink', 4)}${rssItem('Too old to show', 'old', 49)}${rssItem('Same article again', 'dupe', 5)}</channel></rss>`;
  const goodFeed = feedXml; const T0 = T;
  const store = createCfpStore({ fetchImpl, now: () => T, sleep });
  assert.equal(store.snapshot().status, 'building', 'nothing yet: building, not success');
  await store.runOnce();
  const s = store.snapshot();
  assert.equal(s.status, 'ok');
  const by = Object.fromEntries(s.items.map((i) => [i.title, i]));
  assert.ok(by['Fox story headline'] && !by['Same article again'], 'same canonical article appears once (newest post kept)');
  assert.equal(by['Fox story headline'].outlet, 'FOX NEWS'); assert.equal(by['Fox story headline'].image, 'https://static.foxnews.com/a.jpg'); assert.equal(by['Fox story headline'].headlineOnly, false);
  assert.equal(by['Post from X'].headlineOnly, true); assert.equal(by['Post from X'].platform, 'x'); assert.equal(by['Post from X'].outlet, 'X');
  assert.equal(by['Blocked site headline'].headlineOnly, true, '403 article falls back to headline only'); assert.equal(by['Blocked site headline'].blurb, null);
  assert.ok(!by['No link here'], 'post without an article link is not shown'); assert.ok(!by['Too old to show'], '49 h old is dropped');
  assert.ok(!log.some((u) => u.includes('x.com/someone')), 'nothing is fetched from X');
  assert.ok(!log.some((u) => u.includes('/breaking/old/')), 'old post page never fetched');
  for (let i = 1; i < stamps.length; i++) assert.ok(stamps[i] - stamps[i - 1] >= CFP_CRAWL_DELAY_MS, `CFP requests are >= 60 s apart (${i})`);
  // 49 h later everything has aged out, and a feed outage is reported as an error, never as an empty success
  T += 49 * 3600_000; feedXml = '<rss><channel></channel></rss>';
  await store.runOnce();
  const later = store.snapshot(); assert.equal(later.items.length, 0, 'nothing older than 48 h is kept'); assert.equal(later.status, 'error'); assert.match(later.error ?? '', /no usable items/);
  // request-driven stepping (Cloud Run gives CPU only while a request is open): one polite unit of work per call, never closer than 60 s
  feedXml = goodFeed; stamps.length = 0; T = T0 + 600_000;
  const stepped = createCfpStore({ fetchImpl, now: () => T, sleep: async () => { throw new Error('step() must never sleep'); } });
  await stepped.step(); assert.equal(stamps.length, 1, 'first step reads the feed only');
  await stepped.step(); assert.equal(stamps.length, 1, 'a second call inside 60 s does nothing');
  for (let i = 0; i < 8; i++) { T += CFP_CRAWL_DELAY_MS + 1000; await stepped.step(); }
  assert.ok(stepped.snapshot().items.length >= 2, 'stories appear one per step');
  for (let i = 1; i < stamps.length; i++) assert.ok(stamps[i] - stamps[i - 1] >= CFP_CRAWL_DELAY_MS, `stepped CFP requests are >= 60 s apart (${i})`);
  console.log('cfpNews tests ok');
})().catch((e) => { console.error(e); process.exit(1); });
