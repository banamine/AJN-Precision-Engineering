// Live news on Cable TV: separate from the Archive (VOD) rows, never merged, never in the Library.
import assert from 'node:assert/strict';
import { getScheduleForGuide, setCableNewsFetchForTests, setLiveTvFetchForTests } from './guideRegistry.ts';
import { validateLiveNews, getLiveNewsChannels, LIVE_NEWS_GROUP } from './server/liveNewsChannels.ts';
import { libraryFromChannels, LIBRARY_SOURCES } from './server/library.ts';
import data from './server/data/liveNewsChannels.json' with { type: 'json' };
import pinned from './server/data/liveTvPinned.json' with { type: 'json' };

// Archive side stubbed: no network, no Archive rows from search.
setCableNewsFetchForTests((async (input: any) => {
  const url = decodeURIComponent(String(input));
  return url.includes('advancedsearch') ? new Response(JSON.stringify({ response: { docs: [] } }), { status: 200 }) : new Response('', { status: 404 });
}) as typeof fetch);

// 1. The data file passes its own validator: https .m3u8 only, unique ids and URLs, verified.
const raw = (data as { channels: unknown[] }).channels;
const { valid, rejected } = validateLiveNews(raw);
assert.deepEqual(rejected, [], 'no data row is rejected');
assert.equal(valid.length, raw.length);
assert.ok(valid.length >= 20, `live news loaded: ${valid.length}`);

// 2. Validator rejects what it must.
const ok = { id: 'live-news-a', name: 'A', url: 'https://a.example/a.m3u8', verifiedAt: '2026-10-14' };
const bad = validateLiveNews([
  ok,
  { ...ok, id: 'cnn' },                                                // wrong id prefix
  { ...ok, id: 'live-news-b', url: 'http://a.example/b.m3u8' },        // not https
  { ...ok, id: 'live-news-c', url: 'https://www.youtube.com/watch?v=abc' }, // not HLS
  { ...ok, id: 'live-news-a', url: 'https://a.example/d.m3u8' },       // duplicate id
  { ...ok, id: 'live-news-e' },                                        // duplicate stream URL
  { ...ok, id: 'live-news-f', url: 'https://a.example/f.m3u8', verifiedAt: '' }, // unverified
]);
assert.equal(bad.valid.length, 1);
assert.deepEqual(bad.rejected.map((r) => r.reason), [
  'id must start with live-news-', 'stream must be an https .m3u8 URL', 'stream must be an https .m3u8 URL', 'duplicate id', 'duplicate stream URL', 'not verified']);

// Live TV side stubbed: one new News channel, one News channel whose stream URL is already a curated Live News row
// (must be listed once), one non-News channel (must not be added). The merge adds exactly one row.
const dupUrl = valid[0].url;
// Live TV always adds its pinned NTD channels (all group News); none of them is a curated Live News URL.
const pinnedNews = (pinned as { channels: Array<{ url: string; group: string }> }).channels.filter((c) => c.group === 'News' && !valid.some((v) => v.url === c.url)).length;
const liveTvM3u = [
  '#EXTM3U',
  '#EXTINF:-1 tvg-id="MergeNew.us" group-title="News",Merge Test News (720p)', 'https://merge.example/new.m3u8',
  `#EXTINF:-1 tvg-id="MergeDup.us" group-title="News",Merge Duplicate News`, dupUrl,
  '#EXTINF:-1 tvg-id="MergeMusic.us" group-title="Music",Merge Test Music', 'https://merge.example/music.m3u8',
].join('\n');
setLiveTvFetchForTests((async () => new Response(liveTvM3u, { status: 200 })) as typeof fetch);

// 3. Cable TV: Archive rows untouched and first; live rows appended, distinct ids, distinct names.
const cable = await getScheduleForGuide('cable-tv');
const live = cable.filter((c) => c.group === LIVE_NEWS_GROUP);
const archive = cable.filter((c) => c.group !== LIVE_NEWS_GROUP && c.group !== 'FOX Clips'); // FOX Clips (Police Chase) comes last, see test-fox-clips.ts
assert.equal(live.length, valid.length + 1 + pinnedNews, 'every verified live channel is on Cable TV, plus the new Live TV News channels');
assert.ok(live.some((c) => c.name === 'Merge Test News (720p)'), 'Live TV News channel merged into Live News');
assert.ok(!live.some((c) => c.name === 'Merge Duplicate News'), 'identical stream URL is listed once');
assert.ok(!live.some((c) => c.name === 'Merge Test Music'), 'non-News Live TV channels are not added');
assert.equal(new Set(live.map((c) => c.programs[0].mediaUrl)).size, live.length, 'no duplicate stream URLs in Live News');
assert.ok(archive.length >= 10 && archive.some((c) => c.id === 'cnn') && archive.some((c) => c.id === 'bbc'), 'Archive rows still there');
assert.equal(cable.findIndex((c) => c.group === LIVE_NEWS_GROUP), archive.length, 'live rows come after all Archive rows');
assert.ok(live.every((c) => c.id.startsWith('live-')));
assert.equal(live.filter((c) => c.id.startsWith('live-news-')).length, valid.length, 'curated rows keep their live-news- ids');
assert.equal(new Set(cable.map((c) => c.id)).size, cable.length, 'no duplicate channel ids');
assert.equal(new Set(cable.map((c) => c.name.toLowerCase())).size, cable.length, 'no two rows share a name (live twins say LIVE)');
for (const id of ['bbc', 'rt', 'aljazeera', 'france24', 'trt-world', 'dw']) {
  const a = cable.find((c) => c.id === id);
  assert.ok(a, `Archive ${id} still listed`);
  assert.ok(!a!.programs.some((p) => /\.m3u8/i.test(String(p.mediaUrl ?? p.archivePath))), `Archive ${id} has no live stream`);
}
for (const n of ['BBC News World LIVE', 'RT LIVE', 'Al Jazeera English LIVE', 'France 24 LIVE', 'TRT World LIVE', 'DW News LIVE']) assert.ok(live.some((c) => c.name === n), n);

// 4. Every live program is a direct live HLS stream the player can open.
for (const c of live) {
  assert.equal(c.programs.length, 1);
  const p = c.programs[0];
  assert.equal(p.sourceClass, 'm3u_live');
  assert.equal(p.isArchivedSource, false);
  assert.equal(p.mediaType, 'video');
  assert.match(String(p.mediaUrl), /^https:\/\/.+\.m3u8(\?|$)/i);
  assert.equal(p.archivePath, undefined, 'no archive path on a live program');
  assert.equal((p.metadata as any).live, true);
  assert.equal(p.guideId, 'cable-tv');
  assert.equal(p.channelId, c.id);
  assert.equal(Date.parse(p.endTimeUtc!) - Date.parse(p.startTimeUtc!), 86_400_000);
}
// Stable program ids across calls (the program store must not grow per request).
assert.deepEqual(getLiveNewsChannels('cable-tv').map((c) => c.programs[0].id), live.filter((c) => c.id.startsWith('live-news-')).map((c) => c.programs[0].id));

// 5. The Library skips live programs.
const items = libraryFromChannels(LIBRARY_SOURCES.filter((s) => s.guideId === 'cable-tv').map((s) => ({ ...s, channels: cable })));
assert.ok(!items.some((i: any) => live.some((c) => String(i.channelId ?? '') === c.id)), 'live news never appears in the Library');
console.log(`test-live-news-channels: ok (${live.length} live rows after ${archive.length} Archive rows)`);
