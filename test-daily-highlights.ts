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
    { name: 'm3u_split_shows_2026-08-05 (1)/split_shows/Gunsmoke.m3u', format: 'M3U' },
    { name: 'Andy Griffith/Andy Griffith S01E01.mp4', source: 'original', length: '1510.2' },
    { name: 'Hidden/secret.mp4', private: 'true' },
    { name: 'root.mp4' },
  ] }), { status: 200 });
  if (url.includes('Gunsmoke.m3u')) return new Response(m3u, { status: 200 });
  return new Response('', { status: 404 });
}) as typeof fetch;

const r = await dailyHighlightsContract.hook({ guideId: 'classic-tv', fetchImpl: impl }, ctx);
assert.equal(r.status, 'ok');
assert.equal(r.programs.length, 3);
const gs = r.programs.filter((p) => p.channelId === 'classic-gunsmoke');
assert.equal(gs.length, 2);
assert.equal(gs[0].archivePath, '/download/gunsmoke-s1/Gunsmoke%20S01E01%20(1955).mp4', 'M3U link used exactly');
const andy = r.programs.find((p) => p.channelId === 'classic-andy-griffith')!;
assert.equal(andy.archivePath, '/download/daily-highlights/Andy%20Griffith/Andy%20Griffith%20S01E01.mp4');
assert.equal((andy.metadata as any).durationSeconds, 1510.2);
assert.ok(calls.some((u) => u.includes('m3u_split_shows_2026-08-05%20(1)/split_shows/Gunsmoke.m3u')), 'playlist fetched by its listed name');
assert.ok(calls.every((u) => !u.includes('/details/')), 'JSON metadata API only');

const down = await dailyHighlightsContract.hook({ guideId: 'classic-tv', fetchImpl: (async () => new Response('', { status: 503 })) as typeof fetch }, ctx);
assert.equal(down.status, 'upstream_error');
assert.equal(down.error, 'metadata HTTP 503');
console.log('daily highlights regression: all passed');
