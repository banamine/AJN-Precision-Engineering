import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEpgIdentity, EpgIdentityResolutionError } from './epgIdentity';
import { parseM3uUtcTimestamp, normalizeEpochMilliseconds } from '../../channels';

const base = {
  guideId: 'cable-tv',
  channelId: 'fox-news',
  sourceId: 'FOXNEWSW',
  title: 'Hannity (HD)',
  mediaUrl: 'https://cdn-a.example/FOXNEWSW/Hannity.mp4?token=one&start=0&end=300',
  startTimeUtc: Date.UTC(2026, 8, 20, 18),
  endTimeUtc: Date.UTC(2026, 8, 20, 19),
};

test('preserves authoritative IDs', () => {
  const id = buildEpgIdentity({
    ...base,
    programId: 'FOXNEWSW_20260920_180000_Hannity',
    assetId: 'FOXNEWSW_20260920_180000_Hannity',
  });
  assert.equal(id.programId, 'FOXNEWSW_20260920_180000_Hannity');
  assert.equal(id.assetId, 'FOXNEWSW_20260920_180000_Hannity');
});

test('normalizes UTC windows and rejects invalid schedule bounds', () => {
  const a = buildEpgIdentity(base);
  const b = buildEpgIdentity({ ...base, mediaUrl: 'https://cdn-b.example/FOXNEWSW/Hannity.mp4?token=two&start=0&end=300' });
  assert.equal(a.programId, b.programId);
  assert.equal(a.assetId, b.assetId);
  assert.throws(() => buildEpgIdentity({ ...base, startTimeUtc: base.endTimeUtc }), EpgIdentityResolutionError);
});

test('normalizes epoch seconds to milliseconds', () => {
  const seconds = 1758369600;
  assert.equal(normalizeEpochMilliseconds(seconds), 1758369600000);
  assert.equal(normalizeEpochMilliseconds(1758369600000), 1758369600000);
});

test('parses floating feed timestamps explicitly as UTC unless an offset is supplied', () => {
  assert.equal(parseM3uUtcTimestamp('20260920120000'), Date.UTC(2026, 8, 20, 12, 0, 0));
  assert.equal(parseM3uUtcTimestamp('20260920120000+0200'), Date.UTC(2026, 8, 20, 10, 0, 0));
  assert.throws(() => parseM3uUtcTimestamp('2026-09-20T12:00:00Z-unknown'));
});

test('normalizes Unicode and episode notation', () => {
  const a = buildEpgIdentity({ ...base, title: 'Café S01E02 [HD]', mediaUrl: '/download/show.mp4' });
  const b = buildEpgIdentity({ ...base, title: 'Café 1x02', mediaUrl: '/download/show.mp4' });
  assert.equal(a.programId, b.programId);
});

test('rejects partial and non-integer UTC schedule windows', () => {
  assert.throws(() => buildEpgIdentity({ ...base, endTimeUtc: undefined }), EpgIdentityResolutionError);
  assert.throws(() => buildEpgIdentity({ ...base, startTimeUtc: 1.5 }), EpgIdentityResolutionError);
});

test('keeps asset identity stable across CDN mirrors and clipping queries', () => {
  const a = buildEpgIdentity({ ...base, mediaUrl: 'https://cdn-a.example/path/show.mp4?token=a&start=0&end=300' });
  const b = buildEpgIdentity({ ...base, mediaUrl: 'https://cdn-b.example/path/show.mp4?token=b&start=300&end=600' });
  assert.equal(a.assetId, b.assetId);
});

test('isolates new channel/source namespaces', () => {
  const a = buildEpgIdentity(base);
  const b = buildEpgIdentity({ ...base, channelId: 'new-network', tvgId: 'new-network' });
  assert.notEqual(a.sourceId, b.sourceId);
  assert.notEqual(a.programId, b.programId);
});

test('rejects unresolved ownership and unknown identity values', () => {
  assert.throws(() => buildEpgIdentity({ ...base, channelId: '', sourceId: undefined, tvgId: undefined, tvgName: undefined }), EpgIdentityResolutionError);
  const recovered = buildEpgIdentity({ ...base, sourceId: 'unknown' });
  assert.notEqual(recovered.sourceId, 'unknown');
});


test('preserves semantic live query identity while ignoring volatile auth and clipping values', () => {
  const a = buildEpgIdentity({
    ...base,
    channelId: 'alpha',
    sourceId: 'src-shared',
    mediaUrl: 'https://cdn-a.example/live.m3u8?channel=alpha&token=one&start=10',
  });
  const b = buildEpgIdentity({
    ...base,
    channelId: 'beta',
    sourceId: 'src-shared',
    mediaUrl: 'https://cdn-a.example/live.m3u8?channel=beta&token=two&start=20',
  });
  const c = buildEpgIdentity({
    ...base,
    channelId: 'alpha',
    sourceId: 'src-shared',
    mediaUrl: 'https://cdn-b.example/live.m3u8?channel=alpha&token=three&start=30',
  });
  assert.notEqual(a.assetId, b.assetId);
  assert.equal(a.assetId, c.assetId);
});


test('partial authoritative identity is completed deterministically', () => {
  const fromProgram = buildEpgIdentity({
    guideId: 'on-demand',
    channelId: 'direct-stream',
    sourceId: 'src-direct',
    programId: 'prog-authoritative',
    title: 'Example Program',
    mediaUrl: 'https://cdn.example/video.mp4',
  });
  assert.equal(fromProgram.programId, 'prog-authoritative');
  assert.equal(fromProgram.sourceId, 'src-direct');
  assert.equal(fromProgram.assetId, 'asset-video.mp4');

  const fromAsset = buildEpgIdentity({
    guideId: 'on-demand',
    channelId: 'direct-stream',
    sourceId: 'src-direct',
    assetId: 'asset-authoritative',
    title: 'Example Program',
    mediaUrl: 'https://cdn.example/video.mp4',
  });
  assert.equal(fromAsset.programId, 'prog-direct-stream-example-program');
  assert.equal(fromAsset.sourceId, 'src-direct');
  assert.equal(fromAsset.assetId, 'asset-authoritative');
});
