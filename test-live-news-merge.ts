import assert from 'node:assert/strict';
import { mergeLiveTvNews } from './server/liveNewsMerge';
import type { ScheduleChannel } from './src/types';

const mk = (id: string, name: string, url: string, group: string, g = 'x'): ScheduleChannel => ({
  id, guideId: g, name, mediaType: 'video', group,
  programs: [{ id: `${id}|p`, guideId: g, channelId: id, title: name, mediaUrl: url, metadata: { group, live: true } } as any],
});
const curated = [mk('live-news-abc', 'ABC News Live', 'https://a.example/abc.m3u8', 'Live News', 'cable-tv'), mk('live-news-cbs', 'CBS News', 'https://a.example/cbs.m3u8', 'Live News', 'cable-tv')];
const liveTv = [
  mk('live-abc2', 'ABC News Live (dup url)', 'https://a.example/abc.m3u8', 'News'), // identical URL -> dropped
  mk('live-ntd', 'NTD TV', 'https://n.example/ntd.m3u8', 'News'),
  mk('live-ntd-2', 'NTD TV 2', 'https://n.example/ntd.m3u8', 'News'),               // identical URL inside Live TV -> dropped
  mk('live-bbc', 'BBC News', 'https://b.example/bbc.m3u8', 'News'),
  mk('live-cbs', 'CBS News', 'https://c.example/other.m3u8', 'News'),               // same name, different URL -> kept
  mk('live-music', 'Music', 'https://m.example/m.m3u8', 'Music'),                   // not News -> ignored
  mk('live-news-abc', 'Clash', 'https://z.example/z.m3u8', 'News'),                 // id clash -> renamed id
];
const out = mergeLiveTvNews('cable-tv', curated, liveTv, ['bbc news']);
const urls = out.map((c) => c.programs[0].mediaUrl);
assert.equal(new Set(urls).size, urls.length, 'no duplicate URLs');
assert.equal(new Set(out.map((c) => c.id)).size, out.length, 'no duplicate ids');
assert.deepEqual(out.slice(0, 2).map((c) => c.id), ['live-news-abc', 'live-news-cbs'], 'curated rows first and untouched');
assert.equal(out.length, 6);
assert.ok(out.every((c) => c.group === 'Live News' && c.guideId === 'cable-tv' && c.programs[0].guideId === 'cable-tv' && c.programs[0].channelId === c.id));
assert.ok(out.some((c) => c.name === 'BBC News LIVE'), 'archive-name clash gets " LIVE"');
assert.ok(out.some((c) => c.id === 'live-news-abc-2'));
assert.equal(mergeLiveTvNews('cable-tv', [], [], []).length, 0);
console.log(`test-live-news-merge: ok (${out.length} rows)`);
