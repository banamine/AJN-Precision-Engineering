import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import manifestData from './src/data/archiveItemManifest.guide.json';
import snapshotData from './src/data/classicSnapshot.json';
import EpgGuide, { EpgProgramBlock } from './src/EpgGuide';
import { clearScheduleCache, setCachedSchedule } from './src/guide/scheduleCache';
import type { Program, ScheduleChannel } from './src/types';
import {
  ADDITIVE_CLASSIC_CHANNELS, archiveItemPathKey, buildArchiveItemGuideChannels,
  mergeArchiveItemGuideChannels, sortArchiveItemPrograms, type ArchiveItemManifest,
} from './src/services/producers/archiveItemGuideProducer';
import { toChannels, isExcludedPlaylistChannel } from './server/sources/dailyHighlights';
import { notWebPlayableVideo } from './server/sources/archiveLinks';
import { runGroupingTests } from './test-group-programs-for-grid';

const manifest = manifestData as ArchiveItemManifest;
const snapshot = snapshotData.programs as Program[];
const findChannel = (channels: ScheduleChannel[], id: string) => {
  const channel = channels.find(candidate => candidate.id === id);
  assert.ok(channel, `channel missing: ${id}`);
  return channel;
};
const programPath = (program: Program) => program.archivePath ?? program.mediaUrl;
const decodedProgramPath = (program: Program) => {
  try { return decodeURIComponent(programPath(program)); } catch { return programPath(program); }
};
const isIaMp4 = (program: Program) => /\.ia\.mp4$/i.test(decodedProgramPath(program));
const isPlainMp4 = (program: Program) =>
  /\.mp4$/i.test(decodedProgramPath(program)) && !isIaMp4(program);
const duplicatePlainProgramIds = (programs: Program[]) => {
  const iaKeys = new Set(programs.filter(isIaMp4).map(program => archiveItemPathKey(programPath(program))));
  return programs
    .filter(program => isPlainMp4(program) && iaKeys.has(archiveItemPathKey(programPath(program))))
    .map(program => program.id);
};
const archiveIaDuplicatePairCount = (programs: Program[]) => {
  const variants = new Map<string, { plain: number; ia: number }>();
  for (const program of programs) {
    if (!isIaMp4(program) && !isPlainMp4(program)) continue;
    const key = archiveItemPathKey(programPath(program));
    const counts = variants.get(key) ?? { plain: 0, ia: 0 };
    if (isIaMp4(program)) counts.ia++;
    else counts.plain++;
    variants.set(key, counts);
  }
  return [...variants.values()].reduce((total, counts) => total + Math.min(counts.plain, counts.ia), 0);
};

// No test may perform a network request, including lazy source refreshes.
const originalFetch = globalThis.fetch;
let blockedFetches = 0;
globalThis.fetch = (async () => {
  blockedFetches++;
  throw new Error('Network disabled by hermetic archive item guide test');
}) as typeof fetch;

try {
  runGroupingTests();
  console.log('Music grouping invariants: PASS (IDs/order, exact clipped durations, indices, immutability, live/continuation, long-program mode)');
  assert.equal(manifest.items.length, 3825);
  assert.equal(manifest.channels.length, 58);
  assert.equal(new Set(manifest.items.map(row => row.id)).size, manifest.items.length);
  for (const row of manifest.items) {
    assert.match(row.path, /\.(mp3|mp4|opus|webm|m4a)$/i);
    assert.doesNotMatch(JSON.stringify(row), /[\u0400-\u04ff]/u);
    assert.equal(row.guide, true);
    assert.equal(row.conflictWith, null);
    if (row.channelId === 'item-unsorted') assert.ok(row.reason);
    if (row.thumb !== null) assert.ok(row.thumb.startsWith('2015-music.-7z.thumbs/'));
  }
  const musicRows = manifest.items.filter(row => row.lane === 'music');
  assert.equal(musicRows.length, 2357);
  assert.equal(new Set(musicRows.map(row => row.id)).size, 2357);
  assert.ok(musicRows.every(row => row.kind === 'audio'
    && Number.isFinite(row.durationSeconds) && row.durationSeconds > 0
    && /\.(mp3|opus)$/i.test(row.path)));
  console.log(JSON.stringify({
    manifestRows: manifest.items.length, manifestChannels: manifest.channels.length,
    uniqueIds: new Set(manifest.items.map(row => row.id)).size,
    musicTracks: musicRows.length, musicTracksWithRealDuration: musicRows.filter(row =>
      typeof row.durationSeconds === 'number' && Number.isFinite(row.durationSeconds) && row.durationSeconds > 0).length,
    musicDurationSeconds: musicRows.reduce((total, row) => total + (row.durationSeconds ?? 0), 0),
  }));
  console.log('manifest validation: PASS (3825 unique IDs; 58 channels; music durations and audio paths valid)');

  const additions = buildArchiveItemGuideChannels(manifest);
  assert.equal(additions.length, 58);
  const musicAdditions = additions.filter(channel =>
    channel.programs.length > 0 && channel.programs.every(program => program.metadata?.lane === 'music'));
  assert.equal(musicAdditions.length, 25);
  assert.equal(musicAdditions.reduce((total, channel) => total + channel.programs.length, 0), 2357);
  assert.deepEqual(
    musicAdditions.map(channel => channel.id),
    manifest.channels.filter(channel => channel.guide && channel.name.startsWith('Music:')).map(channel => channel.id),
    'music channel order must match manifest order',
  );
  const musicProgramById = new Map(musicRows.map(row => [row.id, row]));
  for (const channel of musicAdditions) {
    for (const program of channel.programs) {
      const row = musicProgramById.get(program.id);
      assert.ok(row, `music source row missing: ${program.id}`);
      assert.equal(program.mediaType, 'audio');
      assert.equal(channel.guideId, 'audio-podcasts');
      assert.equal(channel.group, 'Music');
      assert.equal(program.guideId, 'audio-podcasts');
      assert.notEqual(program.metadata?.epg, 'utc', 'Music keeps the approved local-day convention');
      assert.equal(program.metadata?.durationSeconds, row.durationSeconds);
      assert.equal(program.archivePath, `${manifest.downloadBase}${row.path.split('/').map(encodeURIComponent).join('/')}`);
      assert.equal(program.mediaUrl, program.archivePath);
      assert.equal(program.metadata?.thumbnailUrl, null);
      assert.ok(!program.id.startsWith('item-music'), `obsolete flat music ID found: ${program.id}`);
    }
  }
  console.log(JSON.stringify({
    musicChannels: musicAdditions.length,
    distinctMusicTracks: new Set(musicAdditions.flatMap(channel => channel.programs.map(program => program.id))).size,
    musicRowsByChannel: Object.fromEntries(musicAdditions.map(channel => [channel.name, channel.programs.length])),
  }));
  for (const [id, count] of [
    ['classic-70-odd-couple', 114], ['item-the-odd-couple-2015', 38],
    ['classic-rat-patrol', 58], ['item-unsorted', 210], ['item-the-addams-family', 1],
  ] as const) assert.equal(findChannel(additions, id).programs.length, count);
  assert.equal(findChannel(additions, 'item-unsorted').programs.filter(program => program.mediaType === 'video').length, 192);
  assert.equal(findChannel(additions, 'item-unsorted').programs.filter(program => program.mediaType === 'audio').length, 18);
  for (const channel of additions) {
    if (channel.id !== 'item-unsorted') assert.equal(new Set(channel.programs.map(program => program.mediaType)).size, 1);
  }
  console.log('v3 manifest channel counts/media separation: PASS');
  const existing: ScheduleChannel[] = toChannels(snapshot).map(channel => ({
    ...channel, guideId: 'classic-tv', mediaType: 'video', group: 'Classic TV',
  }));
  const before = JSON.stringify(existing);
  const merged = mergeArchiveItemGuideChannels(existing, additions);
  assert.equal(JSON.stringify(existing), before, 'merge must not mutate the baseline');

  const otherDuplicatePairs = existing
    .filter(channel => !ADDITIVE_CLASSIC_CHANNELS.has(channel.id))
    .map(channel => ({ channelId: channel.id, pairs: archiveIaDuplicatePairCount(channel.programs) }))
    .filter(channel => channel.pairs > 0);
  console.log(JSON.stringify({
    otherChannelDuplicatePairs: otherDuplicatePairs.reduce((total, channel) => total + channel.pairs, 0),
    byChannel: Object.fromEntries(otherDuplicatePairs.map(channel => [channel.channelId, channel.pairs])),
  }));

  for (const [id, added, final] of [
    ['classic-70-odd-couple', 54, 114],
    ['classic-rat-patrol', 17, 58],
  ] as const) {
    const old = findChannel(existing, id);
    const result = findChannel(merged, id);
    const droppedIds = new Set(duplicatePlainProgramIds(old.programs));
    const droppedAsDuplicate = droppedIds.size;
    const keptExistingRows = old.programs.length - droppedAsDuplicate;
    assert.equal(old.programs.length, 60);
    assert.equal(droppedAsDuplicate, id === 'classic-rat-patrol' ? 19 : 0);
    assert.equal(result.programs.length - keptExistingRows, added);
    assert.equal(result.programs.length, final);
    assert.deepEqual(result.programs, sortArchiveItemPrograms(result.programs));
    const resultPaths = new Set(result.programs.map(program => archiveItemPathKey(programPath(program))));
    const missing = old.programs.filter(program => !resultPaths.has(archiveItemPathKey(programPath(program)))).length;
    assert.equal(missing, 0, 'each original path remains directly or through its .ia duplicate');
    for (const program of old.programs.filter(program => !droppedIds.has(program.id))) {
      const preserved = result.programs.find(candidate => candidate.id === program.id);
      assert.ok(preserved, `kept snapshot row missing: ${program.archivePath}`);
      assert.equal(preserved.archivePath, program.archivePath);
      assert.equal(preserved.mediaUrl, program.mediaUrl);
      assert.equal(preserved.sourceId, program.sourceId);
      assert.equal(preserved.assetId, program.assetId);
    }
    for (const program of old.programs.filter(isIaMp4)) {
      const kept = result.programs.find(candidate =>
        archiveItemPathKey(programPath(candidate)) === archiveItemPathKey(programPath(program)));
      assert.ok(kept);
      assert.equal(kept.title, program.title.replace(/\.ia$/i, ''));
    }
    const manifestByPath = new Map(findChannel(additions, id).programs.map(program => [
      archiveItemPathKey(programPath(program)), program,
    ]));
    for (const program of old.programs) {
      const manifestProgram = manifestByPath.get(archiveItemPathKey(programPath(program)));
      if (!manifestProgram) continue;
      const represented = result.programs.find(candidate =>
        archiveItemPathKey(programPath(candidate)) === archiveItemPathKey(programPath(program)));
      assert.ok(represented);
      assert.equal(represented.metadata?.manifestId, manifestProgram.metadata?.manifestId);
      assert.equal(represented.metadata?.thumbnailUrl, manifestProgram.metadata?.thumbnailUrl);
    }
    assert.ok(result.programs.every(program => typeof program.metadata?.thumbnailUrl === 'string'));
    assert.equal(result.programs.length, id === 'classic-rat-patrol' ? 58 : 114);
    if (id === 'classic-rat-patrol') assert.equal(archiveIaDuplicatePairCount(result.programs), 0);
    if (id === 'classic-70-odd-couple') {
      assert.equal(new Set(result.programs.map(program => archiveItemPathKey(program.archivePath!))).size, 114);
    } else {
      assert.equal(new Set(result.programs.map(program => archiveItemPathKey(program.archivePath!))).size, 58);
    }
    console.log(JSON.stringify({
      channelId: id, existing: old.programs.length, droppedAsDuplicate,
      added, final: result.programs.length, missing,
    }));
  }
  for (const channel of existing.filter(channel => !ADDITIVE_CLASSIC_CHANNELS.has(channel.id))) {
    assert.equal(findChannel(merged, channel.id), channel);
    assert.equal(JSON.stringify(findChannel(merged, channel.id)), JSON.stringify(channel));
  }
  console.log('all other existing channels: PASS (same references and byte-for-byte JSON)');

  // A later upstream response cannot replace/remove any packaged target row.
  const refreshed = existing.filter(channel => !ADDITIVE_CLASSIC_CHANNELS.has(channel.id));
  const afterRefresh = mergeArchiveItemGuideChannels(refreshed, additions, existing);
  for (const id of ADDITIVE_CLASSIC_CHANNELS) {
    const channel = findChannel(afterRefresh, id);
    const paths = new Set(channel.programs.map(program => archiveItemPathKey(programPath(program))));
    for (const program of findChannel(existing, id).programs) {
      assert.ok(paths.has(archiveItemPathKey(programPath(program))));
    }
  }
  assert.equal(archiveIaDuplicatePairCount(findChannel(afterRefresh, 'classic-rat-patrol').programs), 0);
  assert.deepEqual(mergeArchiveItemGuideChannels(merged, additions), merged, 'merge must be idempotent');
  console.log('refresh preservation and repeated merge: PASS');

  const forbidden = ['item-hogan-s-heroes', 'item-petticoat-junction', 'item-the-man-from-u-n-c-l-e'];
  assert.ok(forbidden.every(id => !additions.some(channel => channel.id === id)));
  const rejectedRows = manifest.items.slice(0, 2).map((row, index) => ({
    ...row, id: `rejected-${index}`, channelId: 'item-unsorted',
    guide: index === 0 ? false : true, conflictWith: index === 1 ? 'another-source' : null,
  }));
  const filtered = buildArchiveItemGuideChannels({
    ...manifest, channels: manifest.channels.filter(channel => channel.id === 'item-unsorted'),
    items: rejectedRows,
  });
  assert.equal(filtered.length, 0);
  console.log('conflict and guide:false admission: PASS');

  const { layoutDailySchedule, layoutMusicDailySchedule, layoutArchiveItemGuide, getScheduleForGuide } = await import('./guideRegistry');
  const fixedNow = new Date('2026-10-06T00:00:00Z');
  const schedule = (channel: ScheduleChannel) => {
    const sourcePrograms = channel.programs.map(program => ({
      ...program, id: program.id.replace(/:d\d+$/, ''),
    }));
    const isMusic = sourcePrograms.length > 0
      && sourcePrograms.every(program => program.metadata?.lane === 'music');
    return {
      ...channel,
      programs: isMusic
        ? layoutMusicDailySchedule(sourcePrograms, fixedNow)
        : layoutDailySchedule(sourcePrograms, 30, fixedNow, sourcePrograms.length),
    };
  };
  const dayStart = Date.parse('2026-10-06T00:00:00Z');
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  for (const channel of musicAdditions) {
    const laidOut = schedule(channel).programs;
    assert.ok(laidOut.length > 0);
    assert.equal(Date.parse(laidOut[0].startTimeUtc!), dayStart, `${channel.name} day start`);
    assert.equal(Date.parse(laidOut.at(-1)!.endTimeUtc!), dayEnd, `${channel.name} day end`);
    let previousEnd = dayStart;
    laidOut.forEach((program, index) => {
      const source = channel.programs[index % channel.programs.length];
      const start = Date.parse(program.startTimeUtc!);
      const end = Date.parse(program.endTimeUtc!);
      const expectedEnd = Math.min(
        start + Number(source.metadata?.durationSeconds) * 1000,
        dayEnd,
      );
      assert.equal(start, previousEnd, `${channel.name} slot ${index} must have no gap or overlap`);
      assert.equal(end, expectedEnd, `${channel.name} slot ${index} must use its real duration`);
      assert.equal(program.id, `${source.id}:d${index}`);
      assert.equal(program.archivePath, source.archivePath);
      assert.equal(program.mediaUrl, source.mediaUrl);
      assert.equal(program.assetId, source.assetId);
      assert.equal(program.sourceId, source.sourceId);
      assert.equal(program.metadata?.durationSeconds, source.metadata?.durationSeconds);
      previousEnd = end;
    });
  }
  const loveSongs = musicAdditions.find(channel => channel.name.includes('100 Greatest Love Songs'))!;
  assert.ok(schedule(loveSongs).programs.length > loveSongs.programs.length, 'short music lists repeat to fill the day');
  console.log(JSON.stringify({
    musicDayCoverage: 'PASS',
    musicDaySlots: Object.fromEntries(musicAdditions.map(channel => [channel.name, schedule(channel).programs.length])),
    shortChannelRepeated: schedule(loveSongs).programs.length > loveSongs.programs.length,
  }));
  const unsorted = schedule(findChannel(additions, 'item-unsorted'));
  assert.equal(unsorted.name, 'Unsorted');
  assert.equal(unsorted.programs.length, 210);
  clearScheduleCache();
  setCachedSchedule('classic-tv', [unsorted]);
  const rendered = renderToStaticMarkup(<EpgGuide guideId="classic-tv" active={false} />);
  assert.match(rendered, /title="Unsorted"/);
  assert.doesNotMatch(rendered, /Show information|show-info|aria-label="[^"]*[Ii]nfo/);

  const withoutUnsorted = buildArchiveItemGuideChannels({
    ...manifest, items: manifest.items.filter(row => row.channelId !== 'item-unsorted'),
  });
  assert.ok(!withoutUnsorted.some(channel => channel.id === 'item-unsorted'));
  clearScheduleCache();
  setCachedSchedule('classic-tv', [schedule(findChannel(withoutUnsorted, 'classic-70-odd-couple'))]);
  const emptyRendered = renderToStaticMarkup(<EpgGuide guideId="classic-tv" active={false} />);
  assert.doesNotMatch(emptyRendered, /title="Unsorted"/);
  console.log('guide SSR: PASS (populated Unsorted shown, no Info; empty Unsorted absent)');

  for (const kind of ['video', 'audio'] as const) {
    const program = additions.flatMap(channel => channel.programs).find(program => program.mediaType === kind)!;
    const row = manifest.items.find(row => row.id === program.id)!;
    const channel = findChannel(additions, program.channelId);
    let clicked: unknown[] = [];
    const element = EpgProgramBlock({
      program, channel, guideId: 'classic-tv', idx: 0, isLive: false, left: 0, width: 160,
      onSelectProgram: (...args) => { clicked = args; },
    });
    element.props.onClick();
    const expectedPath = manifest.downloadBase + row.path.split('/').map(encodeURIComponent).join('/');
    assert.equal(clicked[0], expectedPath);
    assert.equal(clicked[3], kind);
    assert.equal(clicked[6], program.id);
    assert.equal(clicked[7], program.sourceId);
    assert.equal(clicked[8], program.assetId);
    assert.equal(`/api/archive/proxy?path=${encodeURIComponent(String(clicked[0]))}`,
      `/api/archive/proxy?path=${encodeURIComponent(expectedPath)}`);
    const html = renderToStaticMarkup(element);
    if (row.thumb) {
      const thumbPath = manifest.downloadBase + row.thumb.split('/').map(encodeURIComponent).join('/');
      assert.ok(html.includes(`/api/archive/proxy?path=${encodeURIComponent(thumbPath)}`));
    } else {
      assert.doesNotMatch(html, /data-thumbnail-placeholder/);
      assert.doesNotMatch(html, /<img/);
      assert.ok(html.includes(program.title), 'no-thumbnail title still renders');
    }
  }
  const nullThumb = additions.flatMap(channel => channel.programs).find(program => program.metadata?.thumb === null)!;
  for (const width of [76, 160]) {
    const noThumbnailMarkup = renderToStaticMarkup(EpgProgramBlock({
      program: nullThumb, channel: findChannel(additions, nullThumb.channelId), guideId: 'classic-tv',
      idx: 0, isLive: false, left: 0, width,
    }));
    assert.doesNotMatch(noThumbnailMarkup, /data-thumbnail-placeholder|<img/);
    assert.ok(noThumbnailMarkup.includes(nullThumb.title));
  }
  const firstMusicProgram = musicAdditions[0].programs[0];
  for (const width of [76, 160]) {
    const musicMarkup = renderToStaticMarkup(EpgProgramBlock({
      program: firstMusicProgram, channel: musicAdditions[0], guideId: 'classic-tv',
      idx: 0, isLive: false, left: 0, width,
    }));
    assert.doesNotMatch(musicMarkup, /data-thumbnail-placeholder|<img/);
    assert.ok(musicMarkup.includes(firstMusicProgram.title), 'music title fills a no-thumbnail cell');
  }

  const thumbnailProgram = additions.flatMap(channel => channel.programs)
    .find(program => typeof program.metadata?.thumbnailUrl === 'string')!;
  const thumbnailChannel = findChannel(additions, thumbnailProgram.channelId);
  const narrowTitle = 'A full title in a narrow guide cell';
  const narrowProgram = { ...thumbnailProgram, title: narrowTitle };
  const narrowMarkup = renderToStaticMarkup(EpgProgramBlock({
    program: narrowProgram, channel: thumbnailChannel, guideId: 'classic-tv',
    idx: 0, isLive: false, left: 0, width: 76,
  }));
  assert.ok(narrowMarkup.includes(narrowTitle), 'narrow cell keeps the complete title in the DOM');
  assert.ok(narrowMarkup.includes(`title="${narrowTitle}"`));
  assert.ok(narrowMarkup.includes(`aria-label="${narrowTitle}, ${thumbnailChannel.name}"`));
  assert.match(narrowMarkup, /<img[^>]*class="[^"]*\babsolute\b[^"]*\bobject-cover\b[^"]*\bopacity-30\b/);
  assert.doesNotMatch(narrowMarkup, /<img[^>]*class="[^"]*h-7 w-9 shrink-0 rounded object-cover/);

  const wideMarkup = renderToStaticMarkup(EpgProgramBlock({
    program: narrowProgram, channel: thumbnailChannel, guideId: 'classic-tv',
    idx: 0, isLive: false, left: 0, width: 160,
  }));
  assert.match(wideMarkup, /<img[^>]*class="[^"]*h-7 w-9 shrink-0 rounded object-cover/);
  assert.ok(wideMarkup.indexOf('<img') < wideMarkup.indexOf('relative z-10 truncate font-semibold'),
    'wide cell renders the thumbnail beside and before the title');
  assert.ok(wideMarkup.includes(narrowTitle), 'wide cell keeps the title text');
  console.log('program-block rendering/clicks: PASS (narrow background thumbnail/title/ARIA; wide inline thumbnail; no empty no-thumbnail box; encoded paths, identities, audio/video)');

  // Verify the app's actual schedule producer, not a second implementation.
  const appChannels = await getScheduleForGuide('classic-tv');
  const musicChannelIds = new Set(musicAdditions.map(channel => channel.id));
  const legacyAppChannels = appChannels.filter(channel => !musicChannelIds.has(channel.id));
  const appBaseChannels: ScheduleChannel[] = toChannels(snapshot.filter(program =>
    !isExcludedPlaylistChannel(program.channelId)
    && !notWebPlayableVideo(program.archivePath ?? program.mediaUrl))).map(channel => ({
      ...channel, guideId: 'classic-tv', mediaType: 'video', group: 'Classic TV',
    }));
  // Message 10 final behavior is the baseline, not the pre-Message-10 runtime.
  // Build twice using the exact production merge/layout, identical inputs and
  // a fixed clock. Only the manifest's Music rows/channels differ.
  const nonMusicRows = manifest.items.filter(row => row.lane !== 'music');
  const nonMusicIds = new Set(nonMusicRows.map(row => row.channelId));
  const withoutMusicManifest: ArchiveItemManifest = {
    ...manifest,
    items: nonMusicRows,
    channels: manifest.channels.filter(channel => nonMusicIds.has(channel.id)),
  };
  const guideInput = [findChannel(appChannels, 'honeymooners'), ...appBaseChannels];
  const inputBefore = JSON.stringify(guideInput);
  const comparisonClock = new Date('2026-10-07T00:00:00Z');
  const withoutMusic = layoutArchiveItemGuide(
    guideInput, buildArchiveItemGuideChannels(withoutMusicManifest),
    appBaseChannels, comparisonClock,
  );
  const withMusic = layoutArchiveItemGuide(
    guideInput, buildArchiveItemGuideChannels(manifest),
    appBaseChannels, comparisonClock,
  );
  assert.equal(JSON.stringify(guideInput), inputBefore, 'guide builds must not mutate shared inputs');
  assert.equal(withoutMusic.length, 60);
  assert.equal(withMusic.length, 60);
  assert.equal(withoutMusic.at(-1)?.id, 'item-unsorted', 'Classic must still end with Unsorted');
  for (const [index, expected] of withoutMusic.entries()) {
    const actual = withMusic[index];
    assert.equal(actual.id, expected.id, `existing channel reordered at ${index}`);
    const digest = (channel: ScheduleChannel) =>
      createHash('sha256').update(JSON.stringify(channel)).digest('hex');
    assert.equal(digest(actual), digest(expected),
      `Message 10 channel differs with Music: ${expected.id} (full JSON, no field exclusions)`);
  }
  assert.deepEqual(withMusic.slice(60), [], 'Music may not append to Classic');
  assert.equal(legacyAppChannels.length, 60);
  assert.deepEqual(legacyAppChannels.map(channel => channel.id), withoutMusic.map(channel => channel.id));
  console.log(JSON.stringify({
    message10BaselineChannels: withoutMusic.length,
    identicalExistingChannelsWithMusic: 60,
    comparisonClock: comparisonClock.toISOString(),
    normalizedFields: [],
    musicAppendsAfter: withoutMusic.at(-1)?.name,
  }));
  console.log('Message 10 baseline preservation: PASS (same code with/without Music; all 60 entire channel objects identical at fixed clock)');
  assert.ok(appChannels.every(channel => !channel.id.startsWith('item-music-')));
  const audioChannels = await getScheduleForGuide('audio-podcasts');
  const appMusicChannels = audioChannels.filter(channel => musicChannelIds.has(channel.id));
  assert.equal(appMusicChannels.length, 25);
  assert.equal(appChannels.length, 60, 'Classic keeps its prior 60 non-Music channels');
  assert.deepEqual(appMusicChannels.map(channel => channel.id), musicAdditions.map(channel => channel.id));
  assert.ok(audioChannels.slice(-25).every(channel => musicChannelIds.has(channel.id)),
    'Music appends after the existing Audio channels');
  const today = new Date();
  const actualDayStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const actualDayEnd = actualDayStart + 24 * 60 * 60 * 1000;
  const musicScheduleRowsByChannel: Record<string, number> = {};
  for (const channel of appMusicChannels) {
    const source = findChannel(musicAdditions, channel.id);
    musicScheduleRowsByChannel[channel.name] = channel.programs.length;
    assert.equal(channel.mediaType, 'audio');
    assert.equal(channel.guideId, 'audio-podcasts');
    assert.ok(channel.programs.length > 0);
    assert.equal(Date.parse(channel.programs[0].startTimeUtc!), actualDayStart);
    assert.equal(Date.parse(channel.programs.at(-1)!.endTimeUtc!), actualDayEnd);
    let previousEnd = actualDayStart;
    channel.programs.forEach((program, index) => {
      const sourceProgram = source.programs[index % source.programs.length];
      const start = Date.parse(program.startTimeUtc!);
      const end = Date.parse(program.endTimeUtc!);
      assert.equal(start, previousEnd, `${channel.name} actual API slots must be contiguous`);
      assert.equal(program.id, `${sourceProgram.id}:d${index}`);
      assert.equal(program.mediaType, 'audio');
      assert.equal(program.guideId, 'audio-podcasts');
      assert.notEqual(program.metadata?.epg, 'utc');
      assert.equal(program.archivePath, sourceProgram.archivePath);
      assert.equal(program.mediaUrl, `/api/archive/proxy?path=${encodeURIComponent(sourceProgram.archivePath!)}`);
      assert.equal(program.assetId, sourceProgram.assetId);
      assert.equal(program.sourceId, sourceProgram.sourceId);
      assert.equal(program.metadata?.durationSeconds, sourceProgram.metadata?.durationSeconds);
      assert.equal(end, Math.min(
        start + Number(sourceProgram.metadata?.durationSeconds) * 1000,
        actualDayEnd,
      ));
      previousEnd = end;
    });
  }
  console.log(JSON.stringify({
    preExistingChannelsUnchanged: legacyAppChannels.length,
    musicChannelsInApi: appMusicChannels.length,
    appChannels: appChannels.length,
    audioChannels: audioChannels.length,
    musicScheduleRowsByChannel,
    musicScheduleRows: appMusicChannels.reduce((total, channel) => total + channel.programs.length, 0),
  }));
  console.log('app music schedule: PASS (real durations, manifest order, proxy paths, 24-hour coverage)');
  for (const id of ADDITIVE_CLASSIC_CHANNELS) {
    const result = findChannel(appChannels, id);
    const old = findChannel(existing, id);
    const paths = new Set(result.programs.map(program => archiveItemPathKey(programPath(program))));
    const missing = old.programs.filter(program => !paths.has(archiveItemPathKey(programPath(program)))).length;
    assert.equal(missing, 0);
    const droppedIds = new Set(duplicatePlainProgramIds(old.programs));
    const droppedAsDuplicate = droppedIds.size;
    for (const program of old.programs.filter(program => !droppedIds.has(program.id))) {
      const expectedTitle = isIaMp4(program) ? program.title.replace(/\.ia$/i, '') : program.title;
      assert.ok(result.programs.some(candidate => candidate.archivePath === program.archivePath
        && candidate.title === expectedTitle && candidate.assetId === program.assetId
        && candidate.sourceId === program.sourceId && candidate.id.startsWith(`${program.id}:d`)));
    }
    const added = result.programs.length - (old.programs.length - droppedAsDuplicate);
    assert.equal(result.programs.length, id === 'classic-70-odd-couple' ? 114 : 58);
    assert.equal(result.programs.filter(program => program.metadata?.manifestId).length, result.programs.length);
    assert.ok(result.programs.every(program => typeof program.metadata?.thumbnailUrl === 'string'));
    if (id === 'classic-rat-patrol') assert.equal(archiveIaDuplicatePairCount(result.programs), 0);
    console.log(JSON.stringify({
      channelId: id, existing: old.programs.length, droppedAsDuplicate,
      added, final: result.programs.length, missing,
    }));
  }
  const appUnsorted = findChannel(appChannels, 'item-unsorted');
  assert.equal(appUnsorted.programs.length, 210);
  assert.equal(appUnsorted.programs.filter(program => program.mediaType === 'video').length, 192);
  assert.equal(appUnsorted.programs.filter(program => program.mediaType === 'audio').length, 18);
  assert.equal(findChannel(appChannels, 'item-the-odd-couple-2015').programs.length, 38);
  assert.equal(findChannel(appChannels, 'item-the-addams-family').programs.length, 1);
  const names = appChannels.map(channel => channel.name);
  const duplicateNames = names.filter((name, index) => names.indexOf(name) !== index);
  assert.deepEqual(duplicateNames, []);
  assert.equal(names.filter(name => name === 'Unsorted').length, 1);
  const mixedChannels = appChannels.filter(channel =>
    new Set(channel.programs.map(program => program.mediaType)).size > 1).map(channel => channel.id);
  assert.deepEqual(mixedChannels, ['item-unsorted']);
  console.log(JSON.stringify({
    channelNames: names.length, uniqueChannelNames: new Set(names).size, duplicateNames,
    unsortedNameOccurrences: names.filter(name => name === 'Unsorted').length, mixedChannels,
  }));
  assert.ok(appChannels.flatMap(channel => channel.programs)
    .filter(program => program.metadata?.manifestId)
    .every(program => program.mediaUrl === `/api/archive/proxy?path=${encodeURIComponent(program.archivePath!)}`));
  const admittedExisting = existing.filter(channel =>
    !isExcludedPlaylistChannel(channel.id) && channel.programs.some(program =>
      !notWebPlayableVideo(program.archivePath ?? program.mediaUrl)));
  assert.ok(admittedExisting.every(channel => appChannels.some(result => result.id === channel.id)));
  const admittedSnapshot = toChannels(snapshot.filter(program =>
    !isExcludedPlaylistChannel(program.channelId)
    && !notWebPlayableVideo(program.archivePath ?? program.mediaUrl)));
  for (const channel of admittedSnapshot.filter(channel => !ADDITIVE_CLASSIC_CHANNELS.has(channel.id))) {
    const expected = {
      id: channel.id, guideId: 'classic-tv', name: channel.name, mediaType: 'video',
      group: 'Classic TV',
      programs: layoutDailySchedule(channel.programs, 30).map(program => program.mediaUrl.startsWith('/download/')
        ? { ...program, archivePath: program.archivePath ?? program.mediaUrl,
          mediaUrl: `/api/archive/proxy?path=${encodeURIComponent(program.mediaUrl)}` }
        : program),
      sourceStatus: 'snapshot',
      sourceError: `packaged list from ${snapshotData.fetchedAt}; refreshing`,
    };
    assert.equal(JSON.stringify(findChannel(appChannels, channel.id)), JSON.stringify(expected),
      `unrelated app channel changed: ${channel.id}`);
  }
  console.log('app schedule: PASS (every other admitted snapshot channel byte-for-byte unchanged)');
  console.log(JSON.stringify({
    appChannelsShown: appChannels.length,
    appRows: appChannels.reduce((count, channel) => count + channel.programs.length, 0),
    appUnsortedRows: appUnsorted.programs.length,
    actualNetworkRequests: 0,
    blockedTestFetchCalls: blockedFetches,
  }));
  console.log('archive item guide hermetic tests: ALL PASS');
} finally {
  clearScheduleCache();
  globalThis.fetch = originalFetch;
}
