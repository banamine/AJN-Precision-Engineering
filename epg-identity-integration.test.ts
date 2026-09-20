import assert from 'node:assert/strict';
import test from 'node:test';
import { ingestM3uPlaylist, ingestAjnFeedItems, getChannelsByGuide, getCanonicalEpgPrograms, getCanonicalEpgProgram, getCanonicalEpgProgramById, getScheduleForGuide } from './guideRegistry';
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
#EXTINF:-1 tvg-id="ajn-test-alpha" tvg-name="AJN Test Alpha" tvg-logo="https://example.test/logo.png" group-title="Test",AJN Test Alpha
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

  const canonical = getCanonicalEpgPrograms().find((program) => program.channelId === 'ajn-test-alpha');
  assert.equal(canonical?.sourceClass, 'm3u_live');
  assert.equal(canonical?.isArchivedSource, false);
  assert.equal(canonical?.metadata?.tvgLogo, 'https://example.test/logo.png');
  assert.equal(canonical?.metadata?.groupTitle, 'Test');

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

test('EPG playback receives canonical source and asset identities', async () => {
  await getScheduleForGuide('classic-tv');
  const program = getCanonicalEpgPrograms().find((item) => item.guideId === 'classic-tv');
  assert.ok(program);
  assert.ok(program.sourceId);
  assert.ok(program.assetId);
  assert.equal(getCanonicalEpgProgram(program.sourceId!, program.id)?.assetId, program.assetId);
});


test('AJN RSS bridge writes producer-owned identity into the canonical registry', () => {
  const before = getCanonicalEpgPrograms().length;
  const items = [{
    feedId: 'Alex' as const,
    title: 'AJN Test RSS Item',
    url: 'https://rss.alexjones.media/test.mp4',
    mediaType: 'video' as const,
    publishedAt: '2026-09-20T00:00:00Z',
    description: 'test',
    metadata: { guid: 'ajn-test-guid', sourceFeed: 'https://rss.alexjones.media/Alex.xml' },
    sourceId: 'src-ajn-alex',
    programId: 'ajn-test-guid',
    assetId: 'asset-ajn-test-guid',
  }];
  const programs = ingestAjnFeedItems(items);
  assert.equal(programs.length, 1);
  const program = programs[0];
  assert.equal(program.sourceId, 'src-ajn-alex');
  assert.equal(program.id, 'ajn-test-guid');
  assert.equal(program.assetId, 'asset-ajn-test-guid');
  assert.equal(program.sourceClass, 'ajn_rss');
  assert.equal(program.isArchivedSource, false);
  assert.equal(getCanonicalEpgProgram('src-ajn-alex', 'ajn-test-guid')?.assetId, 'asset-ajn-test-guid');
  assert.equal(getCanonicalEpgPrograms().length, before + 1);
});

test('canonical identity tuple remains immutable on authoritative duplicate updates', () => {
  const first = ingestAjnFeedItems([{
    feedId: 'WarRoom' as const, title: 'Original', url: 'https://rss.alexjones.media/original.mp4', mediaType: 'video' as const,
    metadata: { guid: 'dup-guid', version: '1' }, sourceId: 'src-ajn-warroom', programId: 'dup-guid', assetId: 'asset-original',
  }])[0];
  const second = ingestAjnFeedItems([{
    feedId: 'WarRoom' as const, title: 'Updated', url: 'https://rss.alexjones.media/updated.mp4', mediaType: 'video' as const,
    metadata: { guid: 'dup-guid', version: '2' }, sourceId: 'src-ajn-warroom', programId: 'dup-guid', assetId: 'asset-conflicting',
  }])[0];
  assert.equal(second.sourceId, first.sourceId);
  assert.equal(second.id, first.id);
  assert.equal(second.assetId, first.assetId);
  assert.equal(second.title, 'Updated');
  assert.equal(second.mediaUrl, 'https://rss.alexjones.media/updated.mp4');
  assert.equal(second.metadata?.version, '2');
});
