// Offline regression: server Library projection + M3U/XMLTV export formatting.
import assert from 'node:assert/strict';
import { libraryFromChannels, baseProgramId } from './server/library.ts';
import { toM3u, toXmltv, xmltvTime, externalUrl } from './server/channelExport.ts';

const prog = (o: any) => ({ guideId: 'g', channelId: o.ch ?? 'c', startTime: 0, endTime: 1, mediaType: 'video', ...o });
const channels: any[] = [
  { id: 'nasa-missions', name: 'NASA Mission Archive', group: 'Aerospace & Science', mediaType: 'video', programs: [
    prog({ id: 'nasa-a:d0', title: 'Apollo 11', archivePath: '/download/a/a.mp4', mediaUrl: '/api/archive/proxy?path=%2Fdownload%2Fa%2Fa.mp4', startTimeUtc: '2026-09-27T00:00:00.000Z', endTimeUtc: '2026-09-27T00:15:00.500Z', metadata: { durationSeconds: 900.5, year: '1969' } }),
    prog({ id: 'nasa-a:d7', title: 'Apollo 11 (repeat)', archivePath: '/download/a/a.mp4', startTimeUtc: '2026-09-27T05:00:00.000Z', endTimeUtc: '2026-09-27T05:15:00.000Z', metadata: { durationSeconds: 900 } }),
    prog({ id: 'nasa-b:d1', title: 'Gemini & "4"', archivePath: '/download/b/b%20c.mp4', startTimeUtc: '2026-09-27T00:15:00.000Z', endTimeUtc: '2026-09-27T00:45:00.000Z', metadata: { durationSeconds: 1800, durationEstimated: true } }),
  ] },
  { id: 'docs-x', name: 'Docs', group: 'Documentaries', mediaType: 'video', programs: [prog({ id: 'd1', title: 'Doc', mediaUrl: 'https://ia800100.us.archive.org/1/items/x/x.mp4' })] },
];
const lib = libraryFromChannels([{ guideId: 'science-documentaries', channels, category: (ch: any) => ch.id === 'nasa-missions' ? 'science' : 'documentary' }]);
assert.deepEqual(lib.map((i) => i.id), ['nasa-a', 'nasa-b', 'd1'], 'daily slot suffix removed, repeats deduped');
assert.equal(lib[0].category, 'science'); assert.equal(lib[2].category, 'documentary');
assert.equal(lib[0].duration, '15 min'); assert.equal(lib[1].duration, '~30 min', 'estimated durations marked');
assert.equal(lib[0].year, '1969');
assert.equal(baseProgramId('x:d12'), 'x');

assert.equal(xmltvTime('2026-09-27T10:00:00.000Z'), '20260927100000 +0000');
assert.equal(externalUrl(channels[0].programs[0], 'https://app.example'), 'https://archive.org/download/a/a.mp4');
assert.equal(externalUrl({ mediaUrl: '/api/archive/proxy?path=%2Fdownload%2Fz%2Fz.mp4' } as any, 'https://app'), 'https://archive.org/download/z/z.mp4');
assert.equal(externalUrl(channels[1].programs[0], 'https://app'), null, 'edge-server link never published');
assert.equal(externalUrl({ mediaUrl: '/api/ajn/proxy?url=x' } as any, 'https://app.example'), 'https://app.example/api/ajn/proxy?url=x');

const snap = { guideId: 'science-documentaries', generatedAt: '2026-09-27T09:00:00.000Z', channels };
const m3u = toM3u(snap, ['nasa-missions'], 'https://app.example');
assert.ok(m3u.startsWith('#EXTM3U\n'));
assert.match(m3u, /#EXTINF:901 tvg-id="nasa-missions" tvg-name="NASA Mission Archive" group-title="Aerospace & Science",NASA Mission Archive - Apollo 11\nhttps:\/\/archive\.org\/download\/a\/a\.mp4/);
assert.equal((m3u.match(/#EXTINF/g) || []).length, 2, 'each file once');
assert.ok(!/#EXTINF:\d+\.\d/.test(m3u), 'integer durations only');
assert.ok(!/ia\d+\..*archive\.org/.test(m3u), 'no edge-server links');
assert.match(m3u, /generatedAt 2026-09-27T09:00:00.000Z/);

const live = toM3u({ guideId: 'live-tv', generatedAt: snap.generatedAt, channels: [{ id: 'live-x', name: 'X, News', group: 'News', mediaType: 'video', programs: [prog({ id: 'l', title: 'X', mediaUrl: 'https://x.example/live.m3u8', metadata: { live: true } }), prog({ id: 'l2', title: 'X2', mediaUrl: 'https://x.example/live.m3u8', metadata: { live: true } })] }] as any }, null, 'https://app');
assert.match(live, /#EXTINF:-1 tvg-id="live-x".*,X  News\nhttps:\/\/x\.example\/live\.m3u8\n$/);

const x = toXmltv(snap, ['nasa-missions']);
assert.match(x, /<channel id="nasa-missions"><display-name>NASA Mission Archive<\/display-name><\/channel>/);
assert.match(x, /<programme start="20260927000000 \+0000" stop="20260927001500 \+0000" channel="nasa-missions"><title>Apollo 11<\/title>/);
assert.match(x, /<title>Gemini &amp; &quot;4&quot;<\/title>/);
assert.match(x, /<tv generator-info-name="AJN Precision Engineering" date="20260927090000 \+0000">/);
assert.ok(!x.includes('docs-x'));
// Grouped news show -> one entry per clip, each with its clip length.
const news = toM3u({ guideId: 'cable-tv', generatedAt: snap.generatedAt, channels: [{ id: 'cnn', name: 'CNN', group: 'News', mediaType: 'video', programs: [prog({ id: 's', title: 'Show', archivePath: '/download/S/S.mp4?exact=1&start=0&end=282',
  metadata: { durationSeconds: 3600, segments: [{ archivePath: '/download/S/S.mp4?exact=1&start=0&end=282' }, { archivePath: '/download/S/S.mp4?exact=1&start=282&end=564' }] } })] }] as any }, null, 'https://app');
assert.match(news, /#EXTINF:282 .*Show \(part 1 of 2\)\nhttps:\/\/archive\.org\/download\/S\/S\.mp4\?exact=1&start=0&end=282\n#EXTINF:282 .*part 2 of 2/);
console.log('library + export regression: all passed');
