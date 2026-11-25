import assert from 'node:assert/strict';
import { nowCards, ajnCards, mixCards } from './src/utils/carouselItems';

const nowItem = (g: string) => ({ guideId: g, guideName: `Guide ${g}`, channelId: `ch-${g}`, channelName: `Chan ${g}`, title: `Show ${g}`, startTimeUtc: '2026-10-11T18:00:00Z', endTimeUtc: '2026-10-11T19:30:00Z', mediaType: 'video' as const, archivePath: `/download/${g}/f.mp4`, programId: `p-${g}` });
const now = nowCards(['a', 'b', 'c', 'd', 'e'].map(nowItem), '2026-10-11', () => '12:30 PM');
assert.equal(now.length, 5);
assert.deepEqual(now.map((c) => c.id).sort(), ['now:a:p-a', 'now:b:p-b', 'now:c:p-c', 'now:d:p-d', 'now:e:p-e']);
assert.ok(now.every((c) => c.meta === 'On now · until 12:30 PM' && c.kind === 'now'));
assert.deepEqual(nowCards(['a', 'b', 'c'].map(nowItem), '2026-10-11', () => 'x').map((c) => c.id), nowCards(['c', 'b', 'a'].map(nowItem), '2026-10-11', () => 'x').map((c) => c.id));

const feed = (feedId: string, id: string, title: string, url: string, publishedAt: string, mediaType: 'video' | 'audio') => ({ feedId, id, title, url, publishedAt, mediaType }) as any;
const ajn = ajnCards([
  feed('AJNHourlyVideo', '1', 'VIDEO - 20261009_Fri_WarRoom-Hr1', 'https://x/a.m4v', 'Fri, 09 Oct 2026 22:00:00 -0000', 'video'),
  feed('AJNHourlyVideo', '2', 'VIDEO - 20261010_Sat_Alex-Special', 'https://x/b.m4v', 'Sat, 10 Oct 2026 22:00:00 -0000', 'video'),
  feed('AJNHourlyVideo', '3', 'weird title', 'https://x/c.m4v', 'Thu, 08 Oct 2026 22:00:00 -0000', 'video'),
  feed('AJNHourlyVideo', '4', 'VIDEO - 20261007_Wed_Alex-Hr1', 'https://x/d.m4v', 'Wed, 07 Oct 2026 22:00:00 -0000', 'video'),
  feed('Alex', '5', 'Alex Jones 2026-Oct-09 Friday', 'https://x/e.mp3', 'Fri, 09 Oct 2026 22:00:00 -0000', 'audio'),
  feed('WarRoom', '6', 'War Room 2026-Oct-08 Thursday', 'https://x/f.mp3', 'Thu, 08 Oct 2026 22:00:00 -0000', 'audio'),
  feed('WarRoom', '7', 'War Room 2026-Oct-07 Wednesday', 'https://x/g.mp3', 'Wed, 07 Oct 2026 22:00:00 -0000', 'audio'),
  feed('SundayLive', '8', 'Sunday Night Live 2026-Oct-04 Sunday', 'https://x/h.mp3', 'Sun, 04 Oct 2026 22:00:00 -0000', 'audio'),
]);
assert.equal(ajn.length, 5);                                  // 3 newest video + 2 newest full-show audio
assert.equal(ajn[0].title, 'Alex Jones · Special'); assert.equal(ajn[0].meta, 'Sat Oct 10');
assert.equal(ajn[1].title, 'War Room · Hour 1');
assert.equal(ajn[2].title, 'weird title'); assert.equal(ajn[2].meta, '');   // unparsed: raw title, no invented date
assert.equal(ajn[3].title, 'Alex Jones · Full show');
assert.ok(!ajn.some((c) => c.id === 'ajn:AJNHourlyVideo:4')); // 4th video is beyond the cap
assert.ok(ajn.every((c) => c.thumb === undefined));             // no thumbnail is invented

const mixed = mixCards(now, ajn);
assert.equal(mixed.length, 10);
assert.deepEqual(mixed.map((c) => c.kind), ['now', 'now', 'ajn', 'now', 'now', 'ajn', 'now', 'ajn', 'ajn', 'ajn']);
assert.equal(mixCards([], ajn).length, 5); assert.equal(mixCards(now, []).length, 5); assert.deepEqual(mixCards([], []), []);
console.log('test-carousel-items: all passed');
