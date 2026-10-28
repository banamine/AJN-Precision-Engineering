// Offline regression: Daily News Digest parsing, freshness and the in-memory store (mocked fetch, no network).
import assert from 'node:assert/strict';
import { parseNewsDigest, parseBriefing, digestFreshness, digestNotice, digestAgeLabel, DIGEST_FRESH_HOURS, DIGEST_LATE_HOURS } from './src/utils/newsDigest.ts';
import { createDigestStore } from './server/newsDigest.ts';

const story = (id: string, headline: string, extra: Record<string, unknown> = {}) => ({ id, headline, url: `https://news.example/${id}`, excerpt: 'An &amp;amp; excerpt <b>with</b> markup', published: 'Sun, 04 Oct 2026 11:25:35 GMT', feedName: 'BBC World News', imageUrl: 'https://img.example/a.jpg', ...extra });
const RAW = `### Kyiv bridge hit\n**Source:** BBC World News\n**Summary:** A drone struck the bridge.\nSecond line.\n**Key Theme:** Conflict / Diplomacy\n\n### Second story\n**Source:** Reuters Top News\n**Summary:** Another summary.\n`;
const doc = {
  date: '2026-10-04', last_updated: '2026-10-04T11:46:10.466135+00:00', raw_summary: RAW,
  stories: [story('a', 'Kyiv &amp;amp; bridge'), story('b', 'No link', { url: 'http://insecure.example/x' }), story('c', 'Bad image', { imageUrl: 'javascript:alert(1)' }), { id: 'd', headline: 'No url at all' }],
  rss_feeds_articles: [story('e', 'Reuters one', { feedName: 'Reuters Top News', published: 'Sun, 04 Oct 2026 08:00:00 GMT' }), story('f', 'Reuters newer', { feedName: 'Reuters Top News' }), story('a', 'Kyiv bridge')],
};

// --- parsing
const d = parseNewsDigest(doc);
assert.equal(d.date, '2026-10-04');
assert.equal(d.updatedAt, '2026-10-04T11:46:10.466135+00:00');
assert.deepEqual(d.top.map(i => i.id), ['a', 'c'], 'http:// and url-less stories are dropped');
assert.equal(d.top[0].title, 'Kyiv & bridge', 'double-encoded entities decoded');
assert.equal(d.top[0].excerpt, 'An & excerpt with markup', 'markup stripped, entities decoded');
assert.equal(d.top[1].imageUrl, null, 'non-https image is dropped, not rendered');
assert.equal(d.top[0].imageUrl, 'https://img.example/a.jpg');
assert.deepEqual(d.bySource.map(g => g.source).sort(), ['BBC World News', 'Reuters Top News']);
assert.deepEqual(d.bySource.find(g => g.source === 'Reuters Top News')!.items.map(i => i.id), ['f', 'e'], 'newest first inside a source');
assert.throws(() => parseNewsDigest({ stories: [], rss_feeds_articles: [] }), /no usable stories/);
assert.throws(() => parseNewsDigest(null), /not an object/);

// --- briefing: strict, never invented
assert.deepEqual(d.briefing.map(b => b.headline), ['Kyiv bridge hit', 'Second story']);
assert.equal(d.briefing[0].summary, 'A drone struck the bridge. Second line.');
assert.equal(d.briefing[0].theme, 'Conflict / Diplomacy');
assert.equal(d.briefing[1].theme, null);
assert.deepEqual(parseBriefing('free text with no headings'), []);
assert.deepEqual(parseBriefing(undefined), []);

// --- freshness by the digest's own timestamp
const t0 = Date.parse('2026-10-04T11:46:10Z');
const at = (h: number) => t0 + h * 3_600_000;
assert.equal(digestFreshness(d.updatedAt, at(1)), 'fresh');
assert.equal(digestFreshness(d.updatedAt, at(DIGEST_FRESH_HOURS - 0.1)), 'fresh');
assert.equal(digestFreshness(d.updatedAt, at(DIGEST_FRESH_HOURS + 0.1)), 'late');
assert.equal(digestFreshness(d.updatedAt, at(DIGEST_LATE_HOURS + 0.1)), 'stale');
assert.equal(digestFreshness(null, t0), 'unknown');
assert.equal(digestFreshness('garbage', t0), 'unknown');

// --- notices (what the viewer reads)
assert.deepEqual(digestNotice(d.updatedAt, at(3)), { level: 'ok', text: 'Updated 3 h ago.' });
assert.equal(digestNotice(d.updatedAt, at(40)).level, 'warn');
assert.match(digestNotice(d.updatedAt, at(40)).text, /has not been published yet.*40 h ago/);
assert.equal(digestNotice(d.updatedAt, at(24 * 4)).level, 'stale');
assert.match(digestNotice(d.updatedAt, at(24 * 4)).text, /4 days ago/);
assert.equal(digestNotice(d.updatedAt, at(1), 'HTTP 500').level, 'warn');
assert.match(digestNotice(d.updatedAt, at(1), 'HTTP 500').text, /refresh failed \(HTTP 500\)/);
assert.equal(digestNotice(null, t0).level, 'warn');
assert.equal(digestAgeLabel(0.2), 'under an hour ago');

// --- store
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let clock = 1_000_000; let calls = 0; let mode: 'ok' | '500' | 'empty' | 'html' | 'redirect' | 'hang' = 'ok';
const keepAlive = setInterval(() => {}, 1000); // AbortSignal.timeout timers are unref'd
const fetchImpl = (async (u: URL | string, init?: RequestInit) => {
  calls++;
  assert.equal(new URL(String(u)).hostname, 'pages.example', 'only the digest host is contacted until a redirect is followed');
  if (mode === '500') return new Response('boom', { status: 500 });
  if (mode === 'empty') return json({ stories: [], rss_feeds_articles: [] });
  if (mode === 'html') return new Response('<html>not json</html>', { status: 200 });
  if (mode === 'redirect') return new Response(null, { status: 302, headers: { location: 'https://evil.example/x' } });
  if (mode === 'hang') return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  return json(doc);
}) as unknown as typeof fetch;
const mk = () => createDigestStore({ url: 'https://pages.example/d/data.json', fetchImpl, now: () => clock, ttlMs: 900_000, failureRetryMs: 60_000, timeoutMs: 200 });

let store = mk();
let s = await store.get();
assert.deepEqual([s.status, s.error, s.digest?.top.length, s.fetchedAt !== null], ['ok', null, 2, true]);
await store.get(); assert.equal(calls, 1, 'within the TTL: served from memory');
const parallel = mk(); calls = 0;
await Promise.all([parallel.get(), parallel.get(), parallel.get()]); assert.equal(calls, 1, 'concurrent callers share one fetch');

clock += 900_001; mode = '500'; calls = 0;
s = await store.get();
assert.equal(s.status, 'error'); assert.match(s.error!, /HTTP 500/);
assert.equal(s.digest?.top.length, 2, 'a failed refresh keeps the last good digest');
await store.get(); assert.equal(calls, 1, 'failure is retried after the short backoff, not on every request');
clock += 60_001; mode = 'ok'; s = await store.get();
assert.deepEqual([s.status, s.error], ['ok', null], 'recovers on the next attempt');

for (const bad of ['empty', 'html', 'redirect', 'hang'] as const) {
  mode = bad; const fresh = mk(); const r = await fresh.get();
  assert.equal(r.status, 'error', `${bad}: never cached as success`);
  assert.equal(r.digest, null, `${bad}: no digest invented`);
  assert.ok(r.error, `${bad}: an explicit reason`);
}
mode = 'redirect'; assert.match((await mk().get()).error!, /blocked|not allowed/, 'a redirect off the digest host is refused');

for (const url of ['http://pages.example/x.json', 'not a url']) {
  const r = await createDigestStore({ url, fetchImpl, now: () => clock }).get();
  assert.equal(r.status, 'error'); assert.match(r.error!, /https|valid URL/);
}
clearInterval(keepAlive);
console.log('news digest regression: all passed');
