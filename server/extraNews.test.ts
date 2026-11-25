import assert from 'node:assert';
import { parseRssItems, createExtraNewsStore, type ExtraFeed } from './extraNews';
const NOW = Date.parse('2026-11-25T12:00:00Z');
const feed: ExtraFeed = { id: 't', source: 'Test', url: 'https://feed.example.com/rss' };
const rss = (items: string) => `<?xml version="1.0"?><rss><channel><title>T</title>${items}</channel></rss>`;
const item = (t: string, l: string, d: string) => `<item><title>${t}</title><link>${l}</link><pubDate>${d}</pubDate></item>`;
// parsing: entities decoded once, CDATA, tags stripped, bad rows dropped, newest first, limit
const xml = rss(
  item('<![CDATA[Don&#039;t panic &amp; carry on]]>', 'https://a.example/1', 'Wed, 25 Nov 2026 10:00:00 GMT') +
  item('No date', 'https://a.example/2', 'garbage') + item('Future', 'https://a.example/3', 'Thu, 26 Nov 2026 10:00:00 GMT') +
  item('Plain http link', 'http://a.example/4', 'Wed, 25 Nov 2026 09:00:00 GMT') + item('Older', 'https://a.example/5', 'Tue, 24 Nov 2026 09:00:00 GMT') +
  item('Dup', 'https://a.example/1', 'Wed, 25 Nov 2026 10:00:00 GMT'));
const got = parseRssItems(xml, feed, NOW, 5);
assert.deepEqual(got.map((i) => i.title), ["Don't panic & carry on", 'Older']);
assert.equal(parseRssItems(xml, feed, NOW, 1).length, 1);
// store: success, then a failing refresh keeps the last good list and reports the failure; empty feed is a failure
let t = NOW; let mode: 'ok' | 'down' | 'empty' = 'ok';
const fetchImpl = (async () => mode === 'down' ? new Response('no', { status: 500 }) : new Response(mode === 'empty' ? rss('') : xml, { status: 200, headers: { 'content-type': 'application/rss+xml' } })) as unknown as typeof fetch;
(async () => {
  const store = createExtraNewsStore({ feeds: [feed], fetchImpl, now: () => t, ttlMs: 1000, failureRetryMs: 1000 });
  let s = await store.get(); assert.equal(s.items.length, 2); assert.equal(s.feeds[0].ok, true);
  mode = 'down'; t += 5000; s = await store.get(); assert.equal(s.items.length, 2, 'last good kept'); assert.equal(s.feeds[0].ok, false); assert.match(s.feeds[0].error ?? '', /500/);
  mode = 'empty'; t += 5000; s = await store.get(); assert.equal(s.feeds[0].ok, false); assert.match(s.feeds[0].error ?? '', /no usable items/);
  console.log('extraNews tests ok');
})().catch((e) => { console.error(e); process.exit(1); });
