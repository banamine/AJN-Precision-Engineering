import assert from 'node:assert/strict';
import sources from './src/data/newsRssSources.json';

interface Feed { id: string; name: string; url: string; category: string; via: string; collectedByDigest: boolean }
const feeds = (sources as unknown as { feeds: Feed[] }).feeds;
assert.equal((sources as { schema: string }).schema, 'ajn.newsRssSources.v1');
assert.equal(feeds.length, 19, 'the digest repo lists 19 RSS feeds (not 54)');
assert.equal(new Set(feeds.map((f) => f.id)).size, feeds.length, 'unique ids');
assert.equal(new Set(feeds.map((f) => f.url)).size, feeds.length, 'unique urls');
for (const f of feeds) {
  assert.ok(f.name && f.category, f.id);
  assert.ok(f.url.startsWith('https://') && /^https:\/\/[^/\s]+\.[^/\s]+/.test(f.url), `${f.id}: https url`);
  assert.ok(f.via === 'direct' || f.via === 'google-news-search', `${f.id}: via`);
  assert.equal(f.via === 'google-news-search', f.url.includes('news.google.com/rss/search'), `${f.id}: via matches url`);
}
const by = (c: string) => feeds.filter((f) => f.category === c).length;
assert.deepEqual({ Global: by('Global'), Alternative: by('Alternative'), Finance: by('Finance'), Tech: by('Tech') }, { Global: 6, Alternative: 9, Finance: 2, Tech: 2 });
assert.equal(feeds.filter((f) => f.collectedByDigest).length, 11, 'daily_news.py collects 11 today');
console.log('news rss sources ok', feeds.length, 'feeds,', feeds.filter((f) => f.collectedByDigest).length, 'collected by the digest');
