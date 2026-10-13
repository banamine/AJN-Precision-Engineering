import assert from 'node:assert/strict';
import {
  getLiveRadioStatus,
  getLiveRadioChannels,
  validateLiveRadioStations,
  type LiveRadioStation,
} from './server/liveRadio';

// (a) the real JSON: the 4 curated test stations (KEXP, WUKY, CiTR, CJAD) are in the directory but not the guide; WRFL and CBC are kept but
// rejected as "not verified" (WRFL unreachable, CBC .m3u8 returns 404 and the app has no hls.js).
const status = getLiveRadioStatus();
// stations/enabled count the curated 4 plus the server-only bulk directory; guide counts only what becomes guide channels.
assert.ok(status.stations >= 2000, `bulk directory loaded (${status.stations})`);
assert.equal(status.enabled, status.stations);
assert.equal(status.guide, 0, 'no station is a guide channel: everything is directory only');
assert.deepEqual(status.rejected.map((r) => r.id).sort(), ['radio:ca-cbc-radio-one-toronto', 'radio:us-wrfl'], 'bulk records all valid; only the two unverified curated ones are rejected');
assert.ok(status.rejected.every((r) => r.reason === 'not verified'));
const realChannels = await getLiveRadioChannels('audio-podcasts');
assert.equal(realChannels.length, 0, 'inGuide:false stations are never guide channels (the guide has no Live Radio rows)');

// (b) validateLiveRadioStations rejects, with a reason, each of:
// an http:// stream, country MX, a duplicate id, an id without radio:, a missing verifiedAt
const baseFixture = {
  id: 'radio:us-kexp',
  name: 'KEXP 90.3 FM',
  country: 'US',
  streamUrl: 'https://kexp.streamguys1.com/kexp128.mp3',
  streamType: 'mp3',
  enabled: true,
  verifiedAt: '2026-10-13T00:00:00Z',
};

// 1. an http:// stream
const resHttp = validateLiveRadioStations([{ ...baseFixture, id: 'radio:http', streamUrl: 'http://insecure.example.com/stream.mp3' }]);
assert.equal(resHttp.valid.length, 0);
assert.equal(resHttp.rejected.length, 1);
assert.ok(resHttp.rejected[0].reason.length > 0, 'http stream rejected with reason');

// 2. country MX
const resCountry = validateLiveRadioStations([{ ...baseFixture, id: 'radio:mx', country: 'MX' }]);
assert.equal(resCountry.valid.length, 0);
assert.equal(resCountry.rejected.length, 1);
assert.ok(resCountry.rejected[0].reason.length > 0, 'country MX rejected with reason');

// 3. duplicate id
const resDup = validateLiveRadioStations([
  { ...baseFixture, id: 'radio:dup1' },
  { ...baseFixture, id: 'radio:dup1' },
]);
assert.equal(resDup.valid.length, 1);
assert.equal(resDup.rejected.length, 1);
assert.equal(resDup.rejected[0].id, 'radio:dup1');
assert.ok(resDup.rejected[0].reason.length > 0, 'duplicate id rejected with reason');

// 4. an id without radio:
const resNoPrefix = validateLiveRadioStations([{ ...baseFixture, id: 'station-without-prefix' }]);
assert.equal(resNoPrefix.valid.length, 0);
assert.equal(resNoPrefix.rejected.length, 1);
assert.ok(resNoPrefix.rejected[0].reason.length > 0, 'id without radio: rejected with reason');

// 5. a missing verifiedAt
const resNoVerified = validateLiveRadioStations([{ ...baseFixture, id: 'radio:unverified', verifiedAt: undefined }]);
assert.equal(resNoVerified.valid.length, 0);
assert.equal(resNoVerified.rejected.length, 1);
assert.equal(resNoVerified.rejected[0].reason, 'not verified');

// (c) one valid fixture built INSIDE the test file (never in the JSON) yields exactly one channel with:
// group === 'Live Radio', mediaType === 'audio', sourceClass === 'm3u_live', and mediaUrl === streamUrl
const fixtureStation: LiveRadioStation = {
  id: 'radio:us-kexp',
  name: 'KEXP 90.3 FM',
  country: 'US',
  city: 'Seattle',
  region: 'WA',
  callSign: 'KEXP',
  format: 'Variety / Indie',
  streamUrl: 'https://kexp.streamguys1.com/kexp128.mp3',
  streamType: 'mp3',
  enabled: true,
  verifiedAt: '2026-10-13T00:00:00Z',
};

const fixtureChannels = await getLiveRadioChannels('audio-podcasts', undefined, [fixtureStation]);
assert.equal(fixtureChannels.length, 1);
const ch = fixtureChannels[0];
assert.equal(ch.group, 'Live Radio');
assert.equal(ch.mediaType, 'audio');
assert.equal(ch.programs.length, 1);
const prog = ch.programs[0];
assert.equal(prog.sourceClass, 'm3u_live');
assert.equal(prog.mediaUrl, fixtureStation.streamUrl);
assert.equal(prog.archivePath, fixtureStation.streamUrl);
assert.equal(prog.title, fixtureStation.name);

console.log('test-live-radio: ok');
