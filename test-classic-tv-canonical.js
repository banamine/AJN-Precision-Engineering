import { buildHoneymoonersEpg } from './collections/honeymooners-epg.ts';
import { normalizeProgramIdentity, normalizeAssetIdentity } from './src/utils/epgIdentity.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  console.log('Classic TV canonical identity regression: starting');

  const first = await buildHoneymoonersEpg();
  assert(first.programs.length > 0, 'Classic TV producer must resolve at least one program');

  const second = await buildHoneymoonersEpg();
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
      externalId: `${archiveIdentifier}|slot:${program.startHour ?? 0}`,
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
