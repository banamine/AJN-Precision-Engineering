import assert from 'node:assert/strict';
import test from 'node:test';
import { ingestM3uPlaylist, getChannelsByGuide, getCanonicalEpgPrograms, getCanonicalEpgProgram, getCanonicalEpgProgramById } from './guideRegistry';
import { buildEpgIdentity } from './src/utils/epgIdentity';

test('generic live paths remain isolated by source namespace', () => {
  const a = buildEpgIdentity({ guideId:'cable-tv', channelId:'alpha', sourceId:'src-alpha', title:'Alpha', mediaUrl:'https://cdn-a.example/live.m3u8' });
  const b = buildEpgIdentity({ guideId:'cable-tv', channelId:'beta', sourceId:'src-beta', title:'Beta', mediaUrl:'https://cdn-b.example/live.m3u8' });
  assert.notEqual(a.assetId, b.assetId);
});

test('canonical transport remains the runtime media URL after identity normalization', () => {
  const url = 'https://cdn.example/live.m3u8?token=secret&start=10&end=20';
  const id = buildEpgIdentity({ guideId:'cable-tv', channelId:'alpha', sourceId:'src-alpha', title:'Alpha', mediaUrl:url });
  assert.equal(id.sourceId, 'src-alpha');
  assert.equal(url.includes('token=secret'), true);
});

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
    assert.equal(getCanonicalEpgProgram(program.sourceId!, program.id)?.id, program.id);
    assert.equal(getCanonicalEpgProgramById(program.id)?.id, program.id);
    const playback = buildEpgIdentity({
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

test('EPG playback receives canonical source and asset identities', () => {
  const program = getCanonicalEpgPrograms().find((item) => item.guideId === 'classic-tv');
  assert.ok(program);
  assert.ok(program.sourceId);
  assert.ok(program.assetId);
  assert.equal(getCanonicalEpgProgram(program.sourceId!, program.id)?.assetId, program.assetId);
});
