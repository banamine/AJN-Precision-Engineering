import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEpgIdentity, EpgIdentityResolutionError } from './epgIdentity';

test('uses authoritative producer-owned IDs when supplied', () => {
  const identity = buildEpgIdentity({
    guideId: 'cable-tv',
    channelId: 'fox-news',
    sourceId: 'FOXNEWSW',
    programId: 'FOXNEWSW_20260918_180000_Hannity',
    assetId: 'FOXNEWSW_20260918_180000_Hannity',
    title: 'Hannity',
    mediaUrl: '/download/FOXNEWSW_20260918_180000_Hannity/file.mp4',
  });

  assert.equal(identity.sourceId, 'FOXNEWSW');
  assert.equal(identity.programId, 'FOXNEWSW_20260918_180000_Hannity');
  assert.equal(identity.assetId, 'FOXNEWSW_20260918_180000_Hannity');
});

test('generates deterministic identity independent of input order', () => {
  const input = {
    guideId: 'cable-tv',
    channelId: 'new-channel',
    sourceId: 'source-new-channel',
    title: 'Example Program',
    mediaUrl: 'https://example.invalid/video/example.m3u8?start=0&end=300',
    publishedAt: '2026-09-20T12:00:00Z',
    startTime: 12,
    endTime: 13,
  };

  const a = buildEpgIdentity(input);
  const b = buildEpgIdentity({ ...input, mediaUrl: input.mediaUrl });
  assert.deepEqual(a, b);
});

test('does not use media query clipping markers in asset identity', () => {
  const base = {
    guideId: 'cable-tv',
    channelId: 'cnn',
    sourceId: 'CNNW',
    title: 'CNN Show',
    publishedAt: '2026-09-20T12:00:00Z',
  };

  const a = buildEpgIdentity({
    ...base,
    mediaUrl: '/download/CNNW_20260920_Show/file.mp4?start=0&end=300',
  });
  const b = buildEpgIdentity({
    ...base,
    mediaUrl: '/download/CNNW_20260920_Show/file.mp4?start=300&end=600',
  });

  assert.equal(a.assetId, b.assetId);
});

test('new channel gets an isolated source namespace', () => {
  const existing = buildEpgIdentity({
    guideId: 'cable-tv',
    channelId: 'fox-news',
    tvgId: 'fox-news',
    title: 'Program',
    mediaUrl: '/download/program.mp4',
  });

  const added = buildEpgIdentity({
    guideId: 'cable-tv',
    channelId: 'new-network',
    tvgId: 'new-network',
    title: 'Program',
    mediaUrl: '/download/program.mp4',
  });

  assert.notEqual(existing.sourceId, added.sourceId);
  assert.notEqual(existing.assetId, added.assetId);
});

test('rejects unresolved source ownership instead of creating unknown', () => {
  assert.throws(
    () => buildEpgIdentity({
      guideId: 'cable-tv',
      channelId: '',
      title: 'Unresolved',
      mediaUrl: '/download/unresolved.mp4',
    }),
    EpgIdentityResolutionError,
  );
});
