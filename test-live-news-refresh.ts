// Cable TV live news: automatic playlist re-read + stream checks (no network: fetch is mocked).
import assert from 'node:assert/strict';
import { refreshLiveNewsList, checkLiveNews, currentLiveNews, liveNewsSummary, setLiveNewsFetchForTests, checkLiveNewsStream, liveNewsPendingRechecks } from './server/liveNewsRefresh.ts';
import { getLiveNewsChannels } from './server/liveNewsChannels.ts';
import data from './server/data/liveNewsChannels.json' with { type: 'json' };

const down = new Set<string>();           // hosts answering 500
const noCors = new Set<string>(['nocors.example']);
let playlist = '';
let playlistStatus = 200;
const mock = (async (input: any, init: any) => {
  const u = new URL(String(input));
  if (u.hostname === 'livenow.news') return new Response(playlist, { status: playlistStatus });
  if (down.has(u.hostname)) return new Response('', { status: 500 });
  const h: Record<string, string> = noCors.has(u.hostname) ? {} : { 'access-control-allow-origin': '*' };
  const p = u.pathname;
  if (p.endsWith('/v.m3u8')) return new Response('#EXTM3U\n#EXTINF:6,\ns1.ts\n', { status: 200, headers: h });
  if (p.endsWith('.m3u8')) return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv.m3u8\n', { status: 200, headers: h });
  if (p.endsWith('.ts')) return new Response('x', { status: 206, headers: h });
  return new Response('', { status: 404 });
}) as typeof fetch;
setLiveNewsFetchForTests(mock);

const seed = (data as { channels: Array<{ id: string; tvgId: string; name: string; url: string }> }).channels;
const byTvg = (t: string) => seed.find((c) => c.tvgId === t)!;
const extinf = (tvg: string, name: string, url: string) => `#EXTINF:-1 tvg-id="${tvg}" tvg-name="${name}" tvg-logo="https://livenow.news/i/${tvg}.jpg", ${name}\n${url}\n`;

// Seed rules: News24 in, Press TV out, both BBC channels in.
assert.ok(seed.some((c) => c.name === 'News24' && c.url === 'https://i.mjh.nz/.r/sky-news-now.m3u8'));
assert.ok(!seed.some((c) => /press\s*tv/i.test(c.name) || c.tvgId === 'presstv'));
assert.ok(seed.some((c) => c.name === 'BBC News World LIVE') && seed.some((c) => c.name === 'BBC News UK LIVE'));
assert.equal(currentLiveNews().length, seed.length);

// A single stream check.
assert.deepEqual(await checkLiveNewsStream('https://good.example/a.m3u8'), { ok: true });
const nc = await checkLiveNewsStream('https://nocors.example/a.m3u8');
assert.equal(nc.ok, true); assert.match(nc.corsWarning!, /CORS/); // warning only: never a failure that hides a channel
assert.match((await checkLiveNewsStream('https://down2.example/a.m3u8')).reason ?? 'x', /./); // 404 -> not ok
assert.equal((await checkLiveNewsStream('https://good.example/missing.txt')).ok, false);

// Re-read: a moved stream URL is followed, a new verified channel is added, bad ones are reported, Press TV never appears.
playlist = '#EXTM3U\n'
  + extinf('bbcnews', 'BBC News', 'https://moved.example/bbc/new.m3u8')
  + extinf('newgood', 'New Good News', 'https://good.example/ng.m3u8')
  + extinf('newnocors', 'No Cors News', 'https://nocors.example/nc.m3u8')
  + extinf('newyt', 'YouTube News', 'https://www.youtube.com/watch?v=abc')
  + extinf('newaudio', 'Audio Only', 'https://good.example/live-audio_1=96000.m3u8')
  + extinf('presstv', 'Press TV', 'https://good.example/presstv.m3u8')
  + extinf('dupname', 'News24', 'https://good.example/other24.m3u8');
await refreshLiveNewsList();
let s = liveNewsSummary();
assert.equal(s.lastReadOk, true);
assert.deepEqual(s.urlsUpdated, [byTvg('bbcnews').name]);
assert.ok(currentLiveNews().some((r) => r.id === byTvg('bbcnews').id && r.url === 'https://moved.example/bbc/new.m3u8'), 'url followed');
assert.ok(currentLiveNews().some((r) => r.id === 'live-news-bbcnewsuk'), 'second BBC channel untouched');
assert.deepEqual(s.added, ['New Good News']);
const why = Object.fromEntries(s.notAdded.map((n) => [n.name, n.reason]));
assert.match(why['No Cors News'], /CORS not confirmed/);
assert.match(why['YouTube News'], /direct https/);
assert.match(why['Audio Only'], /audio/);
assert.match(why['News24'], /same name/);
assert.ok(!Object.keys(why).includes('Press TV') && !currentLiveNews().some((r) => /press/i.test(r.name)), 'Press TV is never added');
assert.equal(currentLiveNews().length, seed.length + 1);

// A failed re-read keeps the last good list and says so.
playlistStatus = 503; await refreshLiveNewsList();
s = liveNewsSummary();
assert.equal(s.lastReadOk, false); assert.match(s.lastReadError!, /503/);
assert.equal(currentLiveNews().length, seed.length + 1);
playlistStatus = 200;

// Checks: hidden only after TWO misses in a row; returns on success.
const target = currentLiveNews().find((r) => r.id === 'live-news-newgood')!;
down.add('good.example');
let r = await checkLiveNews(['https://good.example/ng.m3u8'], false);
assert.equal(r.failed, 1);
assert.ok(currentLiveNews().some((c) => c.id === target.id), 'one miss does not hide');
assert.deepEqual(liveNewsPendingRechecks(), [target.url]);
await checkLiveNews(['https://good.example/ng.m3u8'], false);
assert.ok(!currentLiveNews().some((c) => c.id === target.id), 'two misses hide');
assert.equal(liveNewsSummary().hidden, 1);
down.delete('good.example');
await checkLiveNews([target.url], false);
assert.ok(currentLiveNews().some((c) => c.id === target.id), 'one success brings it back');

// If nearly everything fails at once it is our network: nothing is hidden.
for (const c of currentLiveNews()) down.add(new URL(c.url).hostname);
const full1 = await checkLiveNews(); const full2 = await checkLiveNews();
assert.equal(full1.applied, false); assert.equal(full2.applied, false);
assert.equal(liveNewsSummary().checkSkipped, true);
assert.equal(currentLiveNews().length, seed.length + 1, 'nothing hidden');
down.clear();

// Archive twins: a live name equal to an Archive channel name gets " LIVE".
const rows = getLiveNewsChannels('cable-tv', new Date('2026-10-14T12:00:00Z'), [{ id: 'live-news-x', name: 'CNN', url: 'https://a.example/x.m3u8', verifiedAt: 'd' }], ['cnn']);
assert.equal(rows[0].name, 'CNN LIVE');
console.log(`test-live-news-refresh: ok`);
