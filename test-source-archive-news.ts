// Offline regression for the Archive News source contract (mocked Archive JSON).
import assert from 'node:assert/strict';
import { archiveNewsContract, clipWindows, CLIP_SECONDS, parseAirTime, pickPlayableFile } from './server/sources/archiveNews.ts';

const now = new Date('2026-09-23T12:00:00Z');
const ctx = { now, signal: new AbortController().signal };

assert.equal(parseAirTime('CNNW_20260921_080000_CNN_Newsroom_Live')?.airedUtc.toISOString(), '2026-09-21T08:00:00.000Z');
assert.equal(parseAirTime('CNNW_20260921_080000_CNN_Newsroom_Live')?.show, 'CNN Newsroom Live');
assert.equal(parseAirTime('not-a-tv-id'), null);
assert.equal(pickPlayableFile([
  { name: 'a.mp4', source: 'original' },
  { name: 'a.ia.mp4', source: 'derivative' },
]).file?.name, 'a.ia.mp4');
assert.deepEqual(pickPlayableFile([{ name: 'a.mp4', source: 'original', private: 'true' }]), { file: null, allPrivate: true });

assert.equal(CLIP_SECONDS, 282);
assert.deepEqual(clipWindows(600), [[0, 282], [282, 564], [564, 600]]);
assert.equal(clipWindows(3600).length, 13);

type Routes = Record<string, { status: number; body?: unknown }>;
function mockFetch(routes: Routes) {
  const calls: string[] = [];
  const impl = (async (input: any) => {
    const url = String(input);
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    const r = key ? routes[key] : { status: 404 };
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
  return { impl, calls };
}
const input = (fetchImpl: typeof fetch) => ({ network: 'CNNW', channelId: 'cnn', channelName: 'CNN', guideId: 'cable-tv', fetchImpl });

// Mixed: one playable, one restricted, one out of window, one private-only.
{
  const { impl, calls } = mockFetch({
    'collection%3ACNNW%20': { status: 200, body: { response: { docs: [] } } },
    'collection%3ATV-CNNW': { status: 200, body: { response: { docs: [
      { identifier: 'CNNW_20260922_150000_CNN_News_Central' },
      { identifier: 'CNNW_20260921_080000_CNN_Newsroom_Live' },
      { identifier: 'CNNW_20260901_080000_Old_Show' },
      { identifier: 'CNNW_20260920_010000_Private_Show' },
    ] } } },
    'metadata/CNNW_20260922_150000_CNN_News_Central': { status: 200, body: { metadata: { title: 'CNN News Central' }, files: [
      { name: 'CNNW_20260922_150000_CNN_News_Central.mp4', source: 'original', length: '3600' },
      { name: 'CNNW_20260922_150000_CNN_News_Central.ia.mp4', source: 'derivative', length: '3599.5' },
    ] } },
    'metadata/CNNW_20260921_080000_CNN_Newsroom_Live': { status: 200, body: { metadata: { 'access-restricted-item': 'true', title: 'CNN Newsroom Live' }, files: [
      { name: 'CNNW_20260921_080000_CNN_Newsroom_Live.mp4', source: 'original', private: 'true', length: '600' },
    ] } },
    'metadata/CNNW_20260920_010000_Private_Show': { status: 200, body: { is_dark: true } },
  });
  const r = await archiveNewsContract.hook(input(impl), ctx);
  assert.equal(r.status, 'partial');
  // 1 full derivative + 3 clips (600s restricted item) = 4, sorted by air time.
  assert.equal(r.programs.length, 4);
  const clips = r.programs.filter((x) => x.archivePath?.includes('exact=1'));
  assert.deepEqual(clips.map((c) => c.archivePath), [
    '/download/CNNW_20260921_080000_CNN_Newsroom_Live/CNNW_20260921_080000_CNN_Newsroom_Live.mp4?exact=1&start=0&end=282',
    '/download/CNNW_20260921_080000_CNN_Newsroom_Live/CNNW_20260921_080000_CNN_Newsroom_Live.mp4?exact=1&start=282&end=564',
    '/download/CNNW_20260921_080000_CNN_Newsroom_Live/CNNW_20260921_080000_CNN_Newsroom_Live.mp4?exact=1&start=564&end=600',
  ]);
  assert.equal(clips[0].title, 'CNN Newsroom Live 00:00');
  assert.equal(clips[1].startTimeUtc, '2026-09-21T08:04:42.000Z');
  assert.equal(clips[0].mediaUrl, '/api/archive/proxy?path=' + encodeURIComponent(clips[0].archivePath!));
  assert.equal(new Set(r.programs.map((x) => x.id)).size, 4, 'unique clip ids');
  const p = r.programs.find((x) => x.title === 'CNN News Central')!;
  assert.equal(p.title, 'CNN News Central');
  assert.equal(p.startTimeUtc, '2026-09-22T15:00:00.000Z');
  assert.equal(p.endTimeUtc, '2026-09-22T15:59:59.500Z');
  assert.equal(p.archivePath, '/download/CNNW_20260922_150000_CNN_News_Central/CNNW_20260922_150000_CNN_News_Central.ia.mp4');
  assert.ok(p.mediaUrl.startsWith('/api/archive/proxy?path='));
  assert.deepEqual(r.rejected.map((x) => x.reason), [
    'aired outside the 7-day window',
    'restricted: dark item',
  ]);
  assert.ok(calls.every((u) => !u.includes('/details/')), 'JSON APIs only');
  assert.ok(!calls.some((u) => u.includes('metadata/CNNW_20260901')), 'no metadata call for out-of-window items');
  console.log('PASS mixed items');
}

// All restricted -> status 'restricted', not an error.
{
  const { impl } = mockFetch({
    'collection%3ACNNW%20': { status: 200, body: { response: { docs: [{ identifier: 'CNNW_20260922_150000_A' }] } } },
    'metadata/CNNW_20260922_150000_A': { status: 200, body: { is_dark: true } },
  });
  const r = await archiveNewsContract.hook(input(impl), ctx);
  assert.equal(r.status, 'restricted');
  assert.equal(r.error, undefined);
  console.log('PASS all restricted -> restricted');
}

// Search down -> upstream_error with the HTTP status.
{
  const { impl } = mockFetch({ 'advancedsearch': { status: 503 } });
  const r = await archiveNewsContract.hook(input(impl), ctx);
  assert.equal(r.status, 'upstream_error');
  assert.equal(r.error, 'advancedsearch HTTP 503');
  console.log('PASS search outage -> upstream_error');
}

// Metadata requests run concurrently (bounded), not one after another.
{
  let inFlight = 0, peak = 0;
  const docs = Array.from({ length: 12 }, (_, i) => ({ identifier: `CNNW_20260922_${String(10 + i).padStart(2, '0')}0000_Show` }));
  const impl = (async (input: any) => {
    const url = String(input);
    if (url.includes('advancedsearch')) return new Response(JSON.stringify({ response: { docs } }), { status: 200 });
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 20));
    inFlight--;
    return new Response(JSON.stringify({ files: [{ name: 'x.mp4', source: 'derivative', length: '60' }] }), { status: 200 });
  }) as typeof fetch;
  const t0 = Date.now();
  const r = await archiveNewsContract.hook({ network: 'CNNW', channelId: 'cnn', channelName: 'CNN', guideId: 'cable-tv', fetchImpl: impl }, ctx);
  assert.equal(r.programs.length, 12);
  assert.ok(peak > 1 && peak <= 6, `metadata concurrency ${peak}`);
  assert.ok(Date.now() - t0 < 200, 'bounded-parallel metadata');
  console.log('PASS metadata fetched in parallel (peak', peak, ')');
}
console.log('archive news contract regression: all passed');
