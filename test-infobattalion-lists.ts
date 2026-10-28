// Guards the @infobattalion list additions (tools/build-infobattalion-lists.py): bounded payloads, no duplicate ids/names, explicit schema.
import assert from 'node:assert/strict';
import { getScheduleForGuide } from './guideRegistry';
import { buildClassicLightSchedule } from './server/classicLightSchedule';
import extra from './src/data/extraChannelsManifest.json';
import docs from './src/data/documentariesManifest.json';
import audio from './src/data/archiveAudioChannels.json';
import infobattalionReport from './reports/infobattalion-lists.json';

// The TV Guide uses the bounded light schedule, then loads full programs per visible channel.
const BUDGET_MB: Record<string, number> = { 'movies-classics-vault': 3, 'cable-tv': 4, 'science-documentaries': 6 };
const classic = await getScheduleForGuide('classic-tv');
const classicIds = classic.map((channel: any) => channel.id);
assert.equal(classicIds.length, new Set(classicIds).size, 'classic-tv: duplicate channel ids');
const light = buildClassicLightSchedule(classic, Date.now(), '0');
const lightBytes = Buffer.byteLength(JSON.stringify(light));
assert.ok(lightBytes < 2 * 1024 * 1024, `classic-tv light schedule: ${(lightBytes / 1048576).toFixed(1)} MiB exceeds 2 MiB`);
const lightById = new Map(light.channels.map((channel) => [channel.id, channel]));
const deferredCartoonLight = light.channels.filter((channel) => channel.id.startsWith('cx-'));
const deferredLightBytes = Buffer.byteLength(JSON.stringify(deferredCartoonLight));
assert.ok(deferredLightBytes <= 34 * 1024, `deferred cartoon light rows: ${deferredLightBytes} bytes exceeds 34 KiB`);
for (const channel of classic.filter((c: any) => c.id.startsWith('cx-'))) {
  const lazy = lightById.get(channel.id);
  assert.ok(lazy, `classic-tv light schedule missing ${channel.id}`);
  assert.equal(lazy!.programsComplete, false, `${channel.id} must load full episodes on demand`);
  assert.ok(lazy!.programCount > 0, `${channel.id} must advertise its full episode count`);
  assert.equal(lazy!.programs.length, 0, `${channel.id} keeps episodes out of the initial light payload`);
}
for (const guide of Object.keys(BUDGET_MB)) {
  const channels = await getScheduleForGuide(guide);
  const ids = channels.map((c: any) => c.id);
  assert.equal(ids.length, new Set(ids).size, `${guide}: duplicate channel ids`);
  const mb = Buffer.byteLength(JSON.stringify(channels)) / 1048576;
  assert.ok(mb < BUDGET_MB[guide], `${guide}: ${mb.toFixed(1)} MB exceeds budget ${BUDGET_MB[guide]} MB`);
}
const tvx = classic.filter((c: any) => c.id.startsWith('tvx-'));
assert.ok(tvx.length >= 20, `expected the Tv Classics additions, got ${tvx.length}`);
assert.ok(tvx.every((c: any) => c.programs.length > 0 && c.programs.every((p: any) => p.mediaUrl && p.metadata?.durationSeconds > 0)));
const cartoonManifest = (extra as any).channels.filter((c: any) => c.id.startsWith('cx-'));
assert.ok(cartoonManifest.every((c: any) => c.guideId === 'classic-tv' && c.group === 'Cartoons' && c.rows.length > 0));
const itemGuides = new Map<string, Set<string>>();
const recordGuide = (rawId: unknown, guideId: string) => {
  if (typeof rawId !== 'string' || !rawId.trim()) return;
  const id = rawId.trim().toLowerCase();
  const guides = itemGuides.get(id) ?? new Set<string>();
  guides.add(guideId);
  itemGuides.set(id, guides);
};
for (const channel of (extra as any).channels) {
  for (const row of channel.rows ?? []) recordGuide(row.identifier, channel.guideId);
}
for (const entry of docs as any[]) recordGuide(entry.id, 'science-documentaries');
for (const entry of audio as any[]) recordGuide(entry.itemId, 'audio-podcasts');
for (const [id, guideIds] of itemGuides) {
  assert.equal(guideIds.size, 1, `Archive item ${id} appears in multiple guides: ${[...guideIds].join(', ')}`);
}
assert.ok(classic.filter((c: any) => c.id.startsWith('cx-')).every((c: any) => c.programs.length > 0));
const names = classic.map((c: any) => c.name.toLowerCase());
assert.equal(names.length, new Set(names).size, 'classic-tv: duplicate channel names');
for (const [curatedId, archiveId] of [
  ['org-wagon-train', 'tvx-wagon-train'],
  ['org-mamas-family', 'tvx-mama-s-family'],
]) {
  const curated = classic.find((c: any) => c.id === curatedId);
  const archive = classic.find((c: any) => c.id === archiveId);
  if (curated && archive) {
    assert.notEqual(curated.name, archive.name, `${archiveId} must have a distinct source label`);
    assert.match(archive.name, /Archive\.org/, `${archiveId} must identify its Archive source`);
    assert.ok(archive.programs.length > 0, `${archiveId} must retain its programs`);
  }
}
assert.ok(classic.some((c: any) => c.id.startsWith('classic-series-taxi')), 'Taxi must stay');
const movies = await getScheduleForGuide('movies-classics-vault');
for (const id of ['mx-movies-classics-list', 'mx-filmography', 'mx-atlas-taggart']) assert.ok(movies.some((c: any) => c.id === id && c.programs.length > 0), `movies channel ${id}`);
assert.ok((await getScheduleForGuide('cable-tv')).some((c: any) => c.id === 'ajn-new-world-tyranny' && c.programs.length > 0));
assert.equal((extra as any).schema, 'ajn.extraChannelsManifest.v1');
for (const c of (extra as any).channels) for (const r of c.rows) assert.ok(r.durationSeconds >= 30 && r.identifier && r.file, `${c.id}: bad row ${r.id}`);
for (const e of docs as any[]) assert.ok(e.u && e.t && e.g, `docs: bad entry ${e.id}`);
const aids = (audio as any[]).map(a => a.id); assert.equal(aids.length, new Set(aids).size, 'audio channel ids unique');
for (const a of audio as any[]) assert.ok(a.itemId && a.name && a.group, `audio entry ${a.id}`);

type InfobattalionReport = { channels: Record<string, { guide?: string }> };
type ExtraChannel = { id: string; name: string; guideId: string; deferLightRows?: boolean };
type ExtraManifest = { channels: ExtraChannel[] };
const extraChannels = (extra as ExtraManifest).channels;
const extraById = new Map(extraChannels.map((channel) => [channel.id, channel]));
assert.equal(
  extraById.get('cx-disney-anthology-television-series')?.deferLightRows,
  true,
  'new list channels defer episode payloads',
);
const displayNameMappings = (infobattalionReport as any).display_name_mappings as { old: string; new: string }[];
assert.ok(Array.isArray(displayNameMappings), 'report records display-name changes');
const expectedNames: Array<[string, string, string]> = [
  ['cx-all-animated-vhs-and-dvd-and-blu-ray-movies', 'All Animated VHS and DVD and Blu-ray Movies', 'Animated Movies'],
  ['cx-more-full-movie-cinematic-dump-part-3-3', 'More full movie cinematic dump (part 3.3)', 'Animated Movies 3'],
  ['cx-the-incredble-hulk-1966-english', 'The Incredble Hulk (1966) ENGLISH', 'The Incredible Hulk (1966)'],
  ['cx-spider-man-the-new-animated-series-2003-the-hd', 'Spider-Man; The New Animated Series (2003) The HD', 'Spider-Man: The New Animated Series (2003)'],
  ['tvx-the-amazing-spider-man-complete-1977-tv-series-seasons-1-2', 'The Amazing Spider-Man (Complete 1977 TV Series) Seasons 1-2', 'The Amazing Spider-Man (1977) Seasons 1-2'],
];
for (const [channelId, oldName, newName] of expectedNames) {
  assert.equal(extraById.get(channelId)?.name, newName, `${channelId} display name`);
  assert.ok(displayNameMappings.some((mapping) => mapping.old === oldName && mapping.new === newName),
    `report includes ${JSON.stringify({ old: oldName, new: newName })}`);
}
const nameNoise = /(?:\(\s*Upscale\s*\)|\bAI Upscale\b|\b(?:HQ\s*\/\s*HD|HD|HQ)\b|\bDVD ISO NTSC\b|\bwith Subtitles and MKV\b|\(\s*5\.1 RCVR\s*\)|\(fan-remastered\)|\bENGLISH\b|\(\s*complete\b[^)]*\)|\bVHS and DVD and Blu-ray\b|\bIncredble\b|Spider-Man;\s*The New)/i;
for (const channel of extraChannels.filter((item) => /^(cx|tvx)-/.test(item.id))) {
  assert.doesNotMatch(channel.name, nameNoise, `${channel.id} has no upload-noise label`);
  assert.doesNotMatch(channel.name, /(?:\s|—|;|-)+$/, `${channel.id} has no trailing separator`);
}
assert.equal(extraById.get('cx-popeye-the-sailor-man-1933-to-1943')?.name, 'Popeye The Sailor Man 1933 to 1943');
assert.equal(extraById.get('cx-popeye-the-sailor-man-1943-to-1949')?.name, 'Popeye The Sailor Man 1943 to 1949');
const existingPrefixChannel = extraById.get('tvx-riders-of-death-valley-1941');
assert.ok(existingPrefixChannel, 'the existing TVX channel remains in the manifest');
assert.equal(existingPrefixChannel.deferLightRows, undefined, 'legacy TVX channels keep their light-row behavior');
console.log('infobattalion lists OK', { tvx: tvx.length, movies: movies.length, audio: aids.length });
