// Offline regression for the AJN Media (RSS) source contract (mocked feed XML).
import assert from 'node:assert/strict';
import { ajnMediaContract, parseItunesDuration } from './server/sources/ajnMedia.ts';

const now = new Date('2026-09-23T12:00:00Z');
const ctx = { now, signal: new AbortController().signal };
const item = (guid: string, pub: string | null, url: string, extra = '') => `<item>
  <title>Show ${guid}</title>${guid ? `<guid>${guid}</guid>` : ''}
  ${pub ? `<pubDate>${pub}</pubDate>` : ''}<enclosure url="${url}" type="video/mp4"/>${extra}
</item>`;
const feed = (token: string) => `<?xml version="1.0"?><rss><channel>
${item('g-1', 'Tue, 22 Sep 2026 16:00:00 GMT', `https://cdn.ajn.test/a.mp4?t=${token}`, '<itunes:duration>2:58:10</itunes:duration>')}
${item('g-1', 'Tue, 22 Sep 2026 16:00:00 GMT', 'https://cdn.ajn.test/a-dup.mp4')}
${item('g-2', 'Mon, 01 Sep 2026 16:00:00 GMT', 'https://cdn.ajn.test/old.mp4')}
${item('g-3', null, 'https://cdn.ajn.test/nodate.mp4')}
${item('', 'Wed, 23 Sep 2026 10:00:00 GMT', `https://cdn.ajn.test/noguid.mp4?t=${token}`)}
${item('g-5', 'Wed, 23 Sep 2026 09:00:00 GMT', 'http://cdn.ajn.test/insecure.mp4')}
</channel></rss>`;
const fetchWith = (status: number, body = '') => (async () => new Response(body, { status })) as unknown as typeof fetch;

assert.equal(parseItunesDuration('2:58:10'), 10690);
assert.equal(parseItunesDuration('3600'), 3600);
assert.equal(parseItunesDuration('59:30'), 3570);
assert.equal(parseItunesDuration('abc'), undefined);

const a = await ajnMediaContract.hook({ feedId: 'Alex', fetchImpl: fetchWith(200, feed('one')) }, ctx);
assert.equal(a.status, 'partial');
assert.equal(a.programs.length, 2);
const g1 = a.programs.find((p) => p.metadata?.guid === 'g-1')!;
assert.equal(g1.metadata?.externalId, 'Alex:g-1');
assert.equal(g1.startTimeUtc, '2026-09-22T16:00:00.000Z');
assert.equal(g1.endTimeUtc, '2026-09-22T18:58:10.000Z');
assert.equal(g1.metadata?.durationSource, 'rss');
assert.deepEqual(a.rejected.map((r) => r.reason), [
  'duplicate guid in feed',
  'older than 7-day retention window',
  'missing or invalid pubDate',
  'media URL is not HTTPS',
]);
assert.equal(a.programs[0].startTimeUtc, '2026-09-23T10:00:00.000Z', 'newest first');

// Token rotation keeps identity (guid, and URL-without-query when there is no guid).
const b = await ajnMediaContract.hook({ feedId: 'Alex', fetchImpl: fetchWith(200, feed('two')) }, ctx);
assert.deepEqual(b.programs.map((p) => p.id), a.programs.map((p) => p.id));
assert.deepEqual(b.programs.map((p) => p.assetId), a.programs.map((p) => p.assetId));
assert.ok(b.programs.every((p) => !p.mediaUrl.includes('t=one')));

// Same guid in two feeds = two programs.
const w = await ajnMediaContract.hook({ feedId: 'WarRoom', fetchImpl: fetchWith(200, feed('one')) }, ctx);
assert.notEqual(w.programs.find((p) => p.metadata?.guid === 'g-1')!.id, g1.id);

assert.equal((await ajnMediaContract.hook({ feedId: 'Alex', fetchImpl: fetchWith(403) }, ctx)).status, 'restricted');
assert.equal((await ajnMediaContract.hook({ feedId: 'Alex', fetchImpl: fetchWith(502) }, ctx)).status, 'upstream_error');
assert.equal((await ajnMediaContract.hook({ feedId: 'Alex', fetchImpl: fetchWith(200, '<html>login</html>') }, ctx)).error, 'feed Alex did not return RSS/XML');
console.log('ajn media contract regression: all passed');
