// Offline regression: Classic TV channels from archive.org/download/daily-highlights (mocked).
import assert from 'node:assert/strict';
import { dailyHighlightsContract } from './server/sources/dailyHighlights.ts';

const ctx = { now: new Date('2026-09-23T12:00:00Z'), signal: new AbortController().signal };
const m3u = `#EXTM3U
#EXTINF:1500 group-title="Gunsmoke",Gunsmoke S01E01
https://archive.org/download/gunsmoke-s1/Gunsmoke%20S01E01%20(1955).mp4
#EXTINF:1500 group-title="Gunsmoke",Gunsmoke S01E02
https://archive.org/download/gunsmoke-s1/Gunsmoke%20S01E02.mp4
`;
const calls: string[] = [];
const impl = (async (input: any) => {
  const url = String(input); calls.push(url);
  if (url.endsWith('/metadata/daily-highlights')) return new Response(JSON.stringify({ files: [
    { name: 'daily-highlights-organized/m3u_files/Gunsmoke.m3u', format: 'M3U' },
    { name: 'daily-highlights-organized/m3u_files/Honey mooners.m3u', format: 'M3U' },
    { name: 'm3u_split_shows_2026-08-05 (1)/split_shows/Old.m3u', format: 'M3U' },
    { name: 'Andy Griffith/Andy Griffith S01E01.mp4', source: 'original', length: '1510.2' },
    { name: 'Hidden/secret.mp4', private: 'true' },
    { name: 'root.mp4' },
  ] }), { status: 200 });
  if (url.includes('Gunsmoke.m3u')) return new Response(m3u, { status: 200 });
  return new Response('', { status: 404 });
}) as typeof fetch;

const r = await dailyHighlightsContract.hook({ guideId: 'classic-tv', fetchImpl: impl }, ctx);
assert.equal(r.status, 'partial', 'honeymooners playlist is listed as excluded');
assert.equal(r.programs.length, 2, 'only playlists from daily-highlights-organized/m3u_files');
assert.ok(r.rejected.some((x) => x.reason === 'excluded playlist' && /Honey mooners/.test(x.id)));
assert.ok(!calls.some((u) => u.includes('Honey%20mooners') || u.includes('split_shows')), 'excluded and other folders not fetched');
const gs = r.programs.filter((p) => p.channelId === 'classic-gunsmoke');
assert.equal(gs.length, 2);
assert.equal(gs[0].archivePath, '/download/gunsmoke-s1/Gunsmoke%20S01E01%20(1955).mp4', 'M3U link used exactly');
assert.ok(calls.some((u) => u.includes('daily-highlights-organized/m3u_files/Gunsmoke.m3u')), 'playlist fetched by its listed name');
assert.ok(calls.every((u) => !u.includes('/details/')), 'JSON metadata API only');

const down = await dailyHighlightsContract.hook({ guideId: 'classic-tv', fetchImpl: (async () => new Response('', { status: 503 })) as typeof fetch }, ctx);
assert.equal(down.status, 'upstream_error');
assert.equal(down.error, 'metadata HTTP 503');
console.log('daily highlights regression: all passed');
{
  const { displayTitle } = await import('./server/sources/dailyHighlights.ts');
  assert.equal(displayTitle('Канал 31', 'https://archive.org/download/x/Odd%20Couple%20S01E05.mp4', 'Odd'), 'Odd Couple S01E05');
  assert.equal(displayTitle('https://archive.org/download/x/a_b.mp4', 'https://archive.org/download/x/a_b.mp4', 'S'), 'a b');
  assert.equal(displayTitle('Real Title', 'https://x/y.mp4', 'S'), 'Real Title');
  console.log('display titles: passed');
}
{
  const { unplayableReason } = await import('./server/sources/archiveLinks.ts');
  assert.equal(unplayableReason('/download/x/shows.zip/Ep1.mp4'), 'UNPLAYABLE_ARCHIVE_MEMBER');
  assert.equal(unplayableReason('/download/x/pack.7z/a%20b.mp4'), 'UNPLAYABLE_ARCHIVE_MEMBER');
  assert.equal(unplayableReason('/api/archive/proxy?path=' + encodeURIComponent('/download/x/y.tar.gz/z.mp4')), 'UNPLAYABLE_ARCHIVE_MEMBER');
  assert.equal(unplayableReason('/download/x/Ep1.mp4'), null);
  assert.equal(unplayableReason('/download/x/x.mp4?exact=1&start=0&end=282'), null, 'news clips stay playable');
  console.log('archive-member gate: passed');
}

{
  const { toChannels, dailyHighlightsContract } = await import('./server/sources/dailyHighlights.ts');
  const snapshotPrograms = [
    {
      id: 'odd-couple-1',
      guideId: 'classic-tv',
      channelId: 'classic-70-odd-couple',
      title: 'The Odd Couple S01E01',
      description: '70 Odd Couple',
      startTime: 0,
      endTime: 0,
      mediaType: 'video',
      mediaUrl: '/download/x/odd.mp4',
      metadata: { durationSeconds: 1500 },
    },
  ] as any[];
  const channels = toChannels(snapshotPrograms as any);
  assert.equal(channels.length, 1);
  assert.equal(channels[0].name, '70 Odd Couple');
  assert.notEqual(channels[0].name, 'Unsorted');
  console.log('snapshot show fallback: passed');

  const files = [
    'American Experience.m3u',
    'The Man From U.N.C.L.E..m3u',
    '1000 Classic Music.m3u',
    'Good Times.m3u',
  ];
  const playlistBodies = new Map<string,string>(files.map((name) => [
    name,
    '#EXTM3U\n#EXTINF:60 group-title="Show",Show S01E01\nhttps://archive.org/download/x/episode.mp4\n',
  ]));
  const calls: string[] = [];
  const impl = (async (input: any) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/metadata/daily-highlights')) {
      return new Response(JSON.stringify({
        files: files.map((name) => ({ name: `daily-highlights-organized/m3u_files/${name}`, format: 'M3U' })),
      }), { status: 200 });
    }
    const name = decodeURIComponent(url.split('/').pop() ?? '');
    const body = playlistBodies.get(name);
    return body ? new Response(body, { status: 200 }) : new Response('', { status: 404 });
  }) as typeof fetch;
  const r = await dailyHighlightsContract.hook({ guideId: 'classic-tv', fetchImpl: impl }, ctx);
  assert.ok(r.rejected.filter((x) => x.reason === 'excluded playlist').some((x) => /American Experience/.test(x.id)));
  assert.ok(r.rejected.filter((x) => x.reason === 'excluded playlist').some((x) => /The Man From U\.N\.C\.L\.E\./.test(x.id)));
  assert.ok(r.rejected.filter((x) => x.reason === 'excluded playlist').some((x) => /1000 Classic Music/.test(x.id)));
  assert.ok(!r.rejected.some((x) => /Good Times/.test(x.id) && x.reason === 'excluded playlist'));
  console.log('dark playlist admission: passed');
}

{
  const { isExcludedPlaylistChannel, toChannels } = await import('./server/sources/dailyHighlights.ts');
  const mod = await import('./src/data/classicSnapshot.json');
  const snapshot = (mod.default ?? mod) as { programs?: Array<{ channelId: string; description?: string; metadata?: Record<string, unknown> }> };
  const programs = Array.isArray(snapshot.programs) ? snapshot.programs : [];
  const filtered = programs.filter((p) => !isExcludedPlaylistChannel(p.channelId));
  const channels = toChannels(filtered as Parameters<typeof toChannels>[0]);
  const names = channels.map((channel) => channel.name);
  assert.equal(names.includes('Unsorted'), false);
  assert.equal(filtered.some((p) => p.channelId === 'classic-american-experience'), false);
  assert.equal(filtered.some((p) => p.channelId === 'classic-the-man-from-u-n-c-l-e'), false);
  assert.equal(filtered.some((p) => p.channelId === 'classic-1000-classic-music'), false);
  assert.equal(channels.some((channel) => channel.id === 'classic-american-experience'), false);
  assert.equal(channels.some((channel) => channel.id === 'classic-the-man-from-u-n-c-l-e'), false);
  assert.equal(channels.some((channel) => channel.id === 'classic-1000-classic-music'), false);
  console.log(`current snapshot channels: ${channels.map((channel) => channel.name).join(', ')}`);
  console.log('current snapshot dark-channel filter: passed');
}
