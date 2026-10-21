import assert from 'node:assert/strict';
import { allocateFaces, toCubeArticles } from './adapter';
import { syntheticDigestFixture } from './syntheticDigestFixture.test';

const now = Date.parse('2026-10-21T18:00:00.000Z');
const fixture = syntheticDigestFixture(now);
const result = toCubeArticles(fixture, now);

assert.equal(result.articles.length, 8);
assert.equal(result.dropped.duplicate, 6, 'stories are a subset of rss_feeds_articles and deduplicate by id');
assert.equal(result.articles[0].title.startsWith('Synthetic test headline:'), true);
assert.equal(result.articles[0].imageUrl, null, 'Unsplash stock images are not shown');
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

console.log('News Cube adapter: PASS (8 fixture items, 33 allocation, 36 cap, dates, duplicate, fallback and URL cases)');
