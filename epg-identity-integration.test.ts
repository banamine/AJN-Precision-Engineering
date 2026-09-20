import assert from 'node:assert/strict';
import test from 'node:test';
import { ingestM3uPlaylist, getChannelsByGuide, getCanonicalEpgPrograms } from './guideRegistry';
import { normalizePlaybackIdentity } from './src/utils/identityNormalizer';

test('new M3U source adds only its new channels and keeps identity stable on re-ingest', () => {
  const before = getChannelsByGuide('cable-tv').map((channel) => channel.id);
  const playlist = {
    id: 'test-epg-identity',
    name: 'EPG Identity Test',
    sourceUrl: 'local:test.m3u',
    category: 'News',
    enabled: true,
    lastSyncedAt: new Date(0).toISOString(),
    syncStatus: 'pending' as const,
    itemCount: 0,
  };

  const m3u = `#EXTM3U
#EXTINF:-1 tvg-id="ajn-test-alpha" tvg-name="AJN Test Alpha" group-title="Test",AJN Test Alpha
/download/AJNTEST/alpha.mp4
#EXTINF:-1 tvg-id="ajn-test-beta" tvg-name="AJN Test Beta" group-title="Test",AJN Test Beta
/download/AJNTEST/beta.mp4
`;

  const first = ingestM3uPlaylist(playlist, m3u, 'cable-tv');
  const afterFirst = getChannelsByGuide('cable-tv').map((channel) => channel.id);
  assert.equal(afterFirst.length, before.length + 2);
  assert.deepEqual(first.channels.map((channel) => channel.id), ['ajn-test-alpha', 'ajn-test-beta']);

  const firstPrograms = getCanonicalEpgPrograms()
    .filter((program) => program.channelId.startsWith('ajn-test-'))
    .map((program) => ({ channelId: program.channelId, id: program.id, sourceId: program.sourceId, assetId: program.assetId }))
    .sort((a, b) => a.channelId.localeCompare(b.channelId));

  ingestM3uPlaylist(playlist, m3u, 'cable-tv');

  const afterSecond = getChannelsByGuide('cable-tv').map((channel) => channel.id);
  assert.deepEqual(afterSecond, afterFirst);

  const secondPrograms = getCanonicalEpgPrograms()
    .filter((program) => program.channelId.startsWith('ajn-test-'))
    .map((program) => ({ channelId: program.channelId, id: program.id, sourceId: program.sourceId, assetId: program.assetId }))
    .sort((a, b) => a.channelId.localeCompare(b.channelId));

  assert.deepEqual(secondPrograms, firstPrograms);

  for (const program of secondPrograms) {
    const playback = normalizePlaybackIdentity({
      guideId: 'cable-tv',
      channelId: program.channelId,
      sourceId: program.sourceId,
      programId: program.id,
      assetId: program.assetId,
      title: program.channelId,
      mediaUrl: `/download/AJNTEST/${program.channelId.replace('ajn-test-', '')}.mp4`,
    });
    assert.equal(playback.programId, program.id);
    assert.equal(playback.sourceId, program.sourceId);
    assert.equal(playback.assetId, program.assetId);
  }
});
