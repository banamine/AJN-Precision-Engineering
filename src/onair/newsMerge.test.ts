import assert from 'node:assert';
import { canonicalUrl, dedupeNews, splitNews } from './newsMerge';
import type { Headline } from './useOnAirData';
const NOW = Date.parse('2026-11-25T12:00:00Z'); const H = 3600_000;
const h = (id: string, text: string, ageH: number, extra: Partial<Headline> = {}): Headline => ({ id, text, publishedMs: NOW - ageH * H, source: 'S', ...extra });
assert.equal(canonicalUrl('https://www.Site.com/a/?utm_source=z#x'), 'https://site.com/a'); assert.equal(canonicalUrl('javascript:1'), null); assert.equal(canonicalUrl(undefined), null);
// same article from a plain feed and from CFP: shown once, the copy with picture + blurb wins
const plain = h('p', 'Port expands hours', 2, { url: 'https://www.site.com/a?utm_medium=rss' });
const rich = h('c', 'PORT EXPANDS HOURS NOW', 1, { url: 'https://site.com/a/', image: 'https://img.example/a.jpg', blurb: 'Crews will work nights.' });
assert.deepEqual(dedupeNews([plain, rich]).map((x) => x.id), ['c']);
// same headline, different feeds: once
assert.equal(dedupeNews([h('1', 'Same Title', 1), h('2', 'same title', 2)]).length, 1);
// age windows: slide 48 h, ticker 12 h, no platform posts in the ticker, nothing from the future
const all = [h('a', 'Fresh', 1), h('b', 'Yesterday', 30), h('c', 'Ancient', 49), h('d', 'X post', 2, { platform: 'x' }), h('e', 'Future', -1)];
const { ticker, slide } = splitNews(all, NOW, 12);
assert.deepEqual(slide.map((x) => x.id), ['a', 'd', 'b']); assert.deepEqual(ticker.map((x) => x.id), ['a']);
console.log('newsMerge tests ok');
