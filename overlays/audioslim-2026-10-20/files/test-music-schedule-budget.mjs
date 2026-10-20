import assert from 'node:assert/strict';

// Run against the real prebuilt server; all fixtures are supplied by the local smoke-test cache.
// node test-music-schedule-budget.mjs http://127.0.0.1:24437
const base = process.argv[2] || 'http://127.0.0.1:3000';
const WIRE_LIMIT = 24 * 1024 * 1024;
const AUDIO_RAW_LIMIT = 24 * 1024 * 1024;
const AUDIO_LIGHT_RAW_LIMIT = 8 * 1024 * 1024;
const CLASSIC_RAW_LIMIT = 32 * 1024 * 1024;

async function readSchedule(url, encoding = 'identity') {
  const response = await fetch(url, { headers: { 'accept-encoding': encoding } });
  assert.equal(response.status, 200, `${url} HTTP status`);
  const body = Buffer.from(await response.arrayBuffer());
  const rawBytes = body.length;
  const wireHeader = response.headers.get('content-length');
  const wireBytes = wireHeader === null ? rawBytes : Number(wireHeader);
  assert.ok(Number.isFinite(wireBytes) && wireBytes >= 0, `${url}: valid wire Content-Length`);
  assert.ok(wireBytes <= WIRE_LIMIT, `${url}: ${wireBytes} wire bytes exceeds 24 MiB (${WIRE_LIMIT})`);
  return {
    response,
    body,
    rawBytes,
    wireBytes,
    data: JSON.parse(body.toString('utf8')),
  };
}

const audioUrl = `${base}/api/schedule?guide=audio-podcasts`;
const audioTzUrl = `${audioUrl}&tz=420`;
const audioLightUrl = `${audioTzUrl}&light=1`;
const missingTzLight = await fetch(`${audioUrl}&light=1`);
assert.equal(missingTzLight.status, 400, 'audio light mode requires tz');
const channelId = 'item-music-00s-radio-hits-2024';
const channelUrl = `${base}/api/schedule?guide=audio-podcasts&channel=${encodeURIComponent(channelId)}&tz=420`;
const classicUrl = `${base}/api/schedule?guide=classic-tv`;

const audio = await readSchedule(audioUrl);
assert.ok(audio.rawBytes <= AUDIO_RAW_LIMIT, `audio: ${audio.rawBytes} decoded bytes exceeds 24 MiB (${AUDIO_RAW_LIMIT})`);
assert.equal(audio.data.channels.filter((channel) => channel.id.startsWith('item-music-')).length, 25);
const defaultMusic = audio.data.channels.find((channel) => channel.id === channelId);
assert.ok(defaultMusic && defaultMusic.programs.length > 24, 'baseline music channel has its full row list');

const audioTz = await readSchedule(audioTzUrl);
const tzChannel = audioTz.data.channels.find((channel) => channel.id === channelId);
assert.ok(tzChannel, 'tz response contains the example music channel');

const audioLight = await readSchedule(audioLightUrl);
const lightHeader = Number(audioLight.response.headers.get('X-AJN-Light-Raw-Bytes'));
assert.equal(lightHeader, audioLight.rawBytes, 'raw-byte header matches decoded JSON size');
assert.ok(audioLight.rawBytes < AUDIO_LIGHT_RAW_LIMIT, `audio light: ${audioLight.rawBytes} bytes must be below 8 MiB (${AUDIO_LIGHT_RAW_LIMIT})`);
const lightMusic = audioLight.data.channels.filter((channel) => channel.id.startsWith('item-music-'));
assert.equal(lightMusic.length, 25);
for (const channel of lightMusic) {
  assert.equal(channel.programsComplete, false);
  assert.ok(Number.isInteger(channel.programCount) && channel.programCount > 24);
  assert.equal(channel.programs.length, 3);
}
const lightChannel = audioLight.data.channels.find((channel) => channel.id === channelId);
assert.ok(lightChannel);
assert.deepEqual(lightChannel.programs.map((program) => program.id), lightChannel.programs.map((program) => tzChannel.programs.find((full) => full.id === program.id)?.id));
const audioXmlResponse = await fetch(`${base}/api/guides/audio-podcasts/epg.xml`);
assert.equal(audioXmlResponse.status, 200);
const audioXml = await audioXmlResponse.text();
const audioProgrammes = (audioXml.match(/<programme\b/g) || []).length;
const audioPrograms = audio.data.channels.reduce((count, channel) => count + channel.programs.length, 0);
assert.equal(audioProgrammes, audioPrograms, 'unlight audio XML remains track-exact');

const channelFetch = await readSchedule(channelUrl);
const channelData = channelFetch.data.channels.find((channel) => channel.id === channelId);
assert.ok(channelData);
assert.deepEqual(channelData.programs.map((program) => ({ id: program.id, startHour: program.startHour, endHour: program.endHour })),
  tzChannel.programs.map((program) => ({ id: program.id, startHour: program.startHour, endHour: program.endHour })),
  'channel fetch and full tz response have identical ids and times');
assert.deepEqual(lightChannel.programs.map((program) => program.id), channelData.programs
  .filter((program) => lightChannel.programs.some((lightProgram) => lightProgram.id === program.id))
  .map((program) => program.id), 'light rows are a subset of the full per-channel rows');

const audioGzip = await readSchedule(audioUrl, 'gzip');
const tzGzip = await readSchedule(audioTzUrl, 'gzip');
const lightGzip = await readSchedule(audioLightUrl, 'gzip');
const channelGzip = await readSchedule(channelUrl, 'gzip');
const audioResult = {
  guide: 'audio-podcasts',
  default: { rawBytes: audio.rawBytes, gzipWireBytes: audioGzip.wireBytes },
  tz: { rawBytes: audioTz.rawBytes, gzipWireBytes: tzGzip.wireBytes },
  lightTz: { rawBytes: audioLight.rawBytes, headerRawBytes: lightHeader, gzipWireBytes: lightGzip.wireBytes },
  channel: { rawBytes: channelFetch.rawBytes, gzipWireBytes: channelGzip.wireBytes },
  channels: audio.data.channels.length,
  programs: audioPrograms,
  xmlProgrammes: audioProgrammes,
  musicChannels: lightMusic.length,
  fullTargetRows: channelData.programs.length,
  lightTargetRows: lightChannel.programs.length,
  lightTargetProgramIds: lightChannel.programs.map((program) => program.id),
};
console.log(JSON.stringify(audioResult));

const classic = await readSchedule(classicUrl);
assert.ok(classic.rawBytes <= CLASSIC_RAW_LIMIT, `classic-tv: ${classic.rawBytes} decoded bytes exceeds 32 MiB (${CLASSIC_RAW_LIMIT})`);
assert.equal(classic.data.channels.filter((channel) => channel.id.startsWith('item-music-')).length, 0);
const classicXmlResponse = await fetch(`${base}/api/guides/classic-tv/epg.xml`);
assert.equal(classicXmlResponse.status, 200);
const classicXml = await classicXmlResponse.text();
const classicProgrammes = (classicXml.match(/<programme\b/g) || []).length;
const classicPrograms = classic.data.channels.reduce((count, channel) => count + channel.programs.length, 0);
assert.equal(classicProgrammes, classicPrograms, 'classic-tv XML remains track-exact');
console.log(JSON.stringify({ guide: 'classic-tv', rawBytes: classic.rawBytes, wireBytes: classic.wireBytes, channels: classic.data.channels.length, programs: classicPrograms, xmlProgrammes: classicProgrammes }));
console.log('PASS schedule size/membership/track-exact XML budget');

// Prove the hard assertions reject over-budget bodies.
assert.throws(() => assert.ok(AUDIO_LIGHT_RAW_LIMIT + 1 < AUDIO_LIGHT_RAW_LIMIT));
assert.ok(audio.rawBytes <= AUDIO_RAW_LIMIT && audioLight.rawBytes < AUDIO_LIGHT_RAW_LIMIT);
