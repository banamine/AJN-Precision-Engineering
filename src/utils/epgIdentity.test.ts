import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEpgIdentity, EpgIdentityResolutionError } from './epgIdentity';

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
  assert.throws(() => buildEpgIdentity({ ...base, sourceId: 'unknown' }), EpgIdentityResolutionError);
});
