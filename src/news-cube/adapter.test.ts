import assert from 'node:assert/strict';
import { allocateFaces, balanceBySource, CUBE_SOURCE_CAP, toCubeArticles } from './adapter';
import { syntheticDigestFixture } from './syntheticDigestFixture.test';

const now = Date.parse('2026-10-21T18:00:00.000Z');
const fixture = syntheticDigestFixture(now);
const result = toCubeArticles(fixture, now);

assert.equal(result.articles.length, 8);
assert.equal(result.dropped.duplicate, 6, 'stories are a subset of rss_feeds_articles and deduplicate by id');
assert.equal(result.articles[0].title.startsWith('Synthetic test headline:'), true);
assert.equal(result.articles[0].imageUrl, null, 'Unsplash stock images are not shown');
assert.equal(result.articles[0].summary, '', 'raw Google News title/source repetition is shown as title only');
assert.ok(result.articles.every((article) => !('category' in article)), 'source categories are not promoted to topics');
assert.equal(result.articles[0].publishedAt, new Date(now - 3_600_000).toISOString());

const records33 = Array.from({ length: 33 }, (_, index) => ({
  id: `thirty-three-${index}`,
  headline: `Synthetic item ${index}`,
  url: `https://publisher.invalid/items/${index}`,
  published: new Date(now - index * 60_000).toUTCString(),
  feedName: 'Synthetic Network',
  feedId: 'synthetic-network',
}));
const thirtyThree = toCubeArticles({ rss_feeds_articles: records33 }, now);
assert.equal(thirtyThree.articles.length, 33);
assert.deepEqual(allocateFaces(thirtyThree.articles).map((face) => face.articles.filter(Boolean).length), [6, 6, 6, 6, 6, 3]);
assert.equal(allocateFaces(thirtyThree.articles).flatMap((face) => face.articles).filter((article) => article === null).length, 3);
assert.equal(allocateFaces(thirtyThree.articles).flatMap((face) => face.articles).length, 36);
assert.equal(thirtyThree.articles[0].id, 'thirty-three-0', 'newest items sort first');

const exactlyThirtySix = toCubeArticles({ rss_feeds_articles: Array.from({ length: 40 }, (_, index) => ({
  id: `forty-${index}`,
  headline: `Item ${index}`,
  url: `https://publisher.invalid/forty/${index}`,
  published: new Date(now - index * 1000).toUTCString(),
})) }, now);
assert.equal(exactlyThirtySix.articles.length, 40);
assert.equal(allocateFaces(exactlyThirtySix.articles).flatMap((face) => face.articles).length, 36);
assert.equal(allocateFaces(exactlyThirtySix.articles).flatMap((face) => face.articles).filter(Boolean).length, 36);

const varied = toCubeArticles({ rss_feeds_articles: [
  { id: 'tracked', headline: 'Tracking URL safely removed', url: 'https://publisher.invalid/a?utm_source=feed&id=1', published: new Date(now).toUTCString() },
  { id: 'tracked-copy', headline: 'Same URL after safe tracking removal', url: 'https://publisher.invalid/a?id=1&utm_medium=rss', published: new Date(now).toUTCString() },
  { id: 'bad-date', headline: 'Unparseable date', url: 'https://publisher.invalid/bad-date', published: 'not a date' },
  { id: 'very-old', headline: 'Very old date', url: 'https://publisher.invalid/very-old', published: new Date(now - 179_000 * 3_600_000).toUTCString() },
  { id: 'future-ok', headline: 'Future skew inside tolerance', url: 'https://publisher.invalid/future-ok', published: new Date(now + 5 * 60_000).toUTCString() },
  { id: 'future-bad', headline: 'Future skew outside tolerance', url: 'https://publisher.invalid/future-bad', published: new Date(now + 11 * 60_000).toUTCString() },
  { id: 'fake-story', headline: 'Fallback pattern', url: 'https://alexjoneslive.com/story-1', published: new Date(now).toUTCString() },
  { id: 'insecure', headline: 'Non HTTP URL', url: 'javascript:alert(1)', published: new Date(now).toUTCString() },
  { id: 'duplicate-id', headline: 'Id first', url: 'https://publisher.invalid/id-one', published: new Date(now).toUTCString() },
  { id: 'duplicate-id', headline: 'Id duplicate', url: 'https://publisher.invalid/id-two', published: new Date(now).toUTCString() },
  null,
] }, now);
assert.deepEqual(varied.articles.map((article) => article.id), ['future-ok', 'tracked', 'duplicate-id']);
assert.equal(varied.articles.find((article) => article.id === 'tracked')?.canonicalUrl, 'https://publisher.invalid/a?id=1');
assert.equal(varied.dropped.duplicate, 2);
assert.equal(varied.dropped.noDate, 1);
assert.equal(varied.dropped.tooOld, 2);
assert.equal(varied.dropped.fake, 1);
assert.equal(varied.dropped.invalid, 2);
assert.equal(varied.articles.some((article) => article.title === 'Future skew inside tolerance'), true);
assert.equal(varied.articles.some((article) => article.title === 'Future skew outside tolerance'), false);

const htmlSummaries = toCubeArticles({ rss_feeds_articles: [
  {
    id: 'google-news-html',
    headline: 'Transit board approves new route',
    url: 'https://publisher.invalid/google-news',
    feedName: 'Reuters',
    excerpt: '<a href="https://news.google.com/rss/articles/very-long-tracking-token">Transit board approves new route</a>&nbsp;<font>Reuters</font>',
    published: new Date(now).toUTCString(),
  },
  {
    id: 'wordpress-footer',
    headline: 'Council publishes budget summary',
    url: 'https://publisher.invalid/wordpress',
    feedName: 'Local Desk',
    summary: 'The council approved a revised budget after public review. It appeared first on <a href="https://publisher.invalid/">Local Desk</a>',
    published: new Date(now).toUTCString(),
  },
  {
    id: 'cut-off-anchor',
    headline: 'Long summary truncation',
    url: 'https://publisher.invalid/truncated',
    summary: 'Useful context remains readable <a href="https://news.google.com/rss/articles/cut-off',
    published: new Date(now).toUTCString(),
  },
  {
    id: 'entity-summary',
    headline: 'Energy plan & funding',
    url: 'https://publisher.invalid/entities',
    summary: 'R&D &amp; energy&nbsp;funding &#8217;year',
    published: new Date(now).toUTCString(),
  },
  {
    id: 'title-repeat',
    headline: 'Repeated article title',
    url: 'https://publisher.invalid/title-repeat',
    summary: 'Repeated article title',
    published: new Date(now).toUTCString(),
  },
  {
    id: 'publisher-repeat',
    headline: 'Publisher-only summary',
    url: 'https://publisher.invalid/publisher-repeat',
    feedName: 'Reuters',
    summary: 'Reuters',
    published: new Date(now).toUTCString(),
  },
  {
    id: 'title-publisher-repeat',
    headline: 'Market opens higher',
    url: 'https://publisher.invalid/title-publisher-repeat',
    feedName: 'Reuters',
    summary: '<a>Market opens higher</a> &nbsp; Reuters',
    published: new Date(now).toUTCString(),
  },
  {
    id: 'bare-url-summary',
    headline: 'URL only excerpt',
    url: 'https://publisher.invalid/bare-url',
    summary: 'publisher.invalid/a/very/long/story?utm_source=feed',
    published: new Date(now).toUTCString(),
  },
] }, now);
const summaryById = new Map(htmlSummaries.articles.map((article) => [article.id, article.summary]));
assert.equal(summaryById.get('google-news-html'), '', 'Google News anchor title plus publisher is a duplicate-only summary');
assert.equal(summaryById.get('wordpress-footer'), 'The council approved a revised budget after public review.');
assert.equal(summaryById.get('cut-off-anchor'), 'Useful context remains readable', 'an incomplete trailing tag is stripped');
assert.equal(summaryById.get('entity-summary'), 'R&D & energy funding ’year', 'HTML entities decode without HTML rendering');
assert.equal(summaryById.get('title-repeat'), '');
assert.equal(summaryById.get('publisher-repeat'), '');
assert.equal(summaryById.get('title-publisher-repeat'), '');
assert.equal(summaryById.get('bare-url-summary'), '');

const mk = (publisherId: string, n: number) => ({ id: `${publisherId}-${n}`, title: 't', summary: '', publisherName: publisherId, publisherId, publishedAt: '2026-10-21T00:00:00.000Z', canonicalUrl: `https://x.invalid/${publisherId}/${n}`, imageUrl: null });
const heavy = [...Array.from({ length: 20 }, (_, n) => mk('loud', n)), ...['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].flatMap((p) => [mk(p, 0), mk(p, 1), mk(p, 2), mk(p, 3)])];
const balanced = balanceBySource(heavy);
const perPublisher = new Map<string, number>();
for (const article of balanced) perPublisher.set(article.publisherId, (perPublisher.get(article.publisherId) ?? 0) + 1);
assert.equal(balanced.length, 36, 'cube still fills 36 slots');
assert.ok(Math.max(...perPublisher.values()) <= CUBE_SOURCE_CAP, 'no publisher above the cap when enough publishers exist');
assert.equal(perPublisher.size, 9, '36 slots at cap 4 hold 9 publishers: the loud feed no longer takes 20');
assert.deepEqual(balanced.map((a) => a.id), heavy.filter((a) => balanced.includes(a)).map((a) => a.id), 'newest-first order kept');
assert.equal(balanceBySource(Array.from({ length: 12 }, (_, n) => mk('only', n))).length, 12, 'single publisher is topped up, not truncated to the cap');
assert.deepEqual(balanceBySource([]), []);

console.log('News Cube adapter: PASS (real-shaped fixture, 33 allocation, 36 cap, dates, duplicate, fallback, URL and raw-HTML summary cases)');
