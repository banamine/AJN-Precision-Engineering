import { buildHoneymoonersEpg } from './collections/honeymooners-epg.ts';
import { normalizeProgramIdentity, normalizeAssetIdentity } from './src/utils/epgIdentity.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  console.log('Classic TV canonical identity regression: starting');

  const fixtureAssets = [
    {
      id: 'asset-honeymooners-1',
      title: 'The Honeymooners — Episode One',
      archiveIdentifier: 'TheHoneymoonersFixtureOne',
      archivePath: '/download/TheHoneymoonersFixtureOne/episode-one.mp4',
      mediaUrl: '/api/archive/proxy?path=%2Fdownload%2FTheHoneymoonersFixtureOne%2Fepisode-one.mp4',
      durationSeconds: 1800,
      quality: 'HD',
    },
    {
      id: 'asset-honeymooners-2',
      title: 'The Honeymooners — Episode Two',
      archiveIdentifier: 'TheHoneymoonersFixtureTwo',
      archivePath: '/download/TheHoneymoonersFixtureTwo/episode-two.mp4',
      mediaUrl: '/api/archive/proxy?path=%2Fdownload%2FTheHoneymoonersFixtureTwo%2Fepisode-two.mp4',
      durationSeconds: 1800,
      quality: 'HD',
    },
  ];

  const first = await buildHoneymoonersEpg(fixtureAssets);
  assert(first.programs.length > 0, 'Classic TV producer must resolve at least one program');

  const second = await buildHoneymoonersEpg(fixtureAssets);
  assert(second.programs.length === first.programs.length, 'Repeated Classic TV builds must produce the same program count');

  const firstByArchive = new Map(first.programs.map((program) => [program.metadata?.archiveIdentifier, program]));
  const secondByArchive = new Map(second.programs.map((program) => [program.metadata?.archiveIdentifier, program]));

  for (const [archiveIdentifier, program] of firstByArchive) {
    assert(archiveIdentifier, 'Classic TV program must expose archiveIdentifier');
    const repeat = secondByArchive.get(archiveIdentifier);
    assert(repeat, `Repeated build must retain archive item ${archiveIdentifier}`);
    assert(program.metadata?.externalId === archiveIdentifier, `Classic TV externalId must equal archiveIdentifier for ${archiveIdentifier}`);
    assert(repeat.metadata?.externalId === archiveIdentifier, `Repeated Classic TV build must retain externalId for ${archiveIdentifier}`);

    const expectedProgramId = normalizeProgramIdentity({
      externalId: `${archiveIdentifier}|slot:${(program.startTime ?? 0) * 3600}`,
      channelId: program.channelId,
      title: program.title,
      startTime: program.startTimeUtc,
    });
    assert(repeat.id === program.id, `Repeated Classic TV build must preserve program ID for ${archiveIdentifier}`);
    assert(program.id === expectedProgramId, `Program ID must derive from archive identity for ${archiveIdentifier}`);

    const expectedAssetId = normalizeAssetIdentity({
      externalId: archiveIdentifier,
      programId: program.id,
      mediaUrl: program.mediaUrl,
    });
    assert(program.assetId === expectedAssetId, `Asset ID must derive from archive identity for ${archiveIdentifier}`);
    assert(program.startTimeUtc && program.endTimeUtc, `UTC lifecycle fields must exist for ${archiveIdentifier}`);
  }

  const ids = first.programs.map((program) => program.id);
  assert(new Set(ids).size === ids.length, 'Classic TV build must not create duplicate program IDs');

  console.log('Classic TV canonical identity regression: PASS');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
