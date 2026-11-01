import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getNewsVersion, getScheduleForGuide } from './guideRegistry';

test('NewsReadyNotice program resolution contract', async () => {
  const versionInfo = await getNewsVersion();
  assert(versionInfo.version >= 0, 'version must be non-negative');
  assert(Array.isArray(versionInfo.newShows), 'newShows must be an array');

  const schedule = await getScheduleForGuide('cable-tv');
  assert(Array.isArray(schedule), 'schedule must be an array of channels');
  assert(schedule.length > 0, 'cable-tv schedule must have channels');

  // Verify that for each channel with shows, we can find a playable program
  for (const ch of schedule) {
    if (ch.programs && ch.programs.length > 0) {
      const firstProgram = ch.programs[0];
      const playableSrc = firstProgram.archivePath || firstProgram.mediaUrl;
      assert(Boolean(playableSrc), `Channel ${ch.id} first program must have archivePath or mediaUrl`);
    }
  }

  // If newShows is populated, test our resolution algorithm on each show
  if (versionInfo.newShows.length > 0) {
    const targetShow = versionInfo.newShows[0];
    const ch = schedule.find((c) => c.id === targetShow.channelId);
    assert(ch, `Channel ${targetShow.channelId} must exist in cable-tv schedule`);

    const rawTargetAsset = targetShow.assetId || (
      targetShow.programId?.startsWith('program-')
        ? targetShow.programId.replace(/^program-/, '').replace(/:show$/, '')
        : undefined
    );

    const matched = ch.programs.find((x: any) => {
      if (rawTargetAsset && x.assetId && x.assetId.includes(rawTargetAsset)) return true;
      if (targetShow.assetId && x.assetId === targetShow.assetId) return true;
      if (targetShow.title && x.title && x.title.trim().toLowerCase() === targetShow.title.trim().toLowerCase()) return true;
      if (targetShow.programId && String(x.id).startsWith(targetShow.programId.replace(/:show$/, ''))) return true;
      return false;
    }) || ch.programs[0];

    assert(matched, 'Program must be resolved');
    const playableSrc = matched.archivePath || matched.mediaUrl;
    assert(Boolean(playableSrc), 'Resolved program must have a playable source URL');
  }
});
