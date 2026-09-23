// Offline regression for the Archive News source contract (mocked Archive JSON).
import assert from 'node:assert/strict';
import { archiveNewsContract, parseAirTime, pickPlayableFile } from './server/sources/archiveNews.ts';

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
    'metadata/CNNW_20260921_080000_CNN_Newsroom_Live': { status: 200, body: { metadata: { 'access-restricted-item': 'true' }, files: [] } },
    'metadata/CNNW_20260920_010000_Private_Show': { status: 200, body: { files: [{ name: 'x.mp4', source: 'original', private: 'true' }] } },
  });
  const r = await archiveNewsContract.hook(input(impl), ctx);
  assert.equal(r.status, 'partial');
  assert.equal(r.programs.length, 1);
  const p = r.programs[0];
  assert.equal(p.title, 'CNN News Central');
  assert.equal(p.startTimeUtc, '2026-09-22T15:00:00.000Z');
  assert.equal(p.endTimeUtc, '2026-09-22T15:59:59.500Z');
  assert.equal(p.archivePath, '/download/CNNW_20260922_150000_CNN_News_Central/CNNW_20260922_150000_CNN_News_Central.ia.mp4');
  assert.ok(p.mediaUrl.startsWith('/api/archive/proxy?path='));
  assert.deepEqual(r.rejected.map((x) => x.reason), [
    'restricted: access-restricted item',
    'aired outside the 7-day window',
    'restricted: all MP4 files are private',
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
  assert.equal(r.error, 'advancedsearch HTTP 503, 503');
  console.log('PASS search outage -> upstream_error');
}
console.log('archive news contract regression: all passed');
