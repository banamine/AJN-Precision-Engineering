import assert from 'node:assert/strict';
import { corsModeFor, liveRadioAllowsMeter, NO_METER_MARK } from './src/utils/mediaRoute.ts';
const kexp = 'https://kexp-mp3-128.streamguys1.com/kexp128.mp3';
// verified live stations (corsVerified + verifiedAt in src/data/liveRadioSources.json): CORS mode, so the signal meter can read them
for (const id of ['radio:us-kexp:live:d0', 'radio:us-wuky:live:d0', 'radio:ca-citr:live:d0', 'radio:ca-cjad:live:d0']) {
  assert.equal(liveRadioAllowsMeter(id), true, id);
  assert.equal(corsModeFor(kexp, false, id), 'anonymous', id);
}
// hidden / unverified stations and unknown ids never get CORS mode
for (const id of ['radio:us-wrfl:live:d0', 'radio:ca-cbc-radio-one-toronto:live:d0', 'radio:us-kexpx:live:d0', 'pod-quash-1', undefined]) {
  assert.equal(liveRadioAllowsMeter(id as any), false, String(id));
  assert.equal(corsModeFor(kexp, false, id as any), undefined, String(id));
}
// http streams never use CORS mode; after a CORS failure the same stream plays natively
assert.equal(corsModeFor('http://insecure.example/s.mp3', false, 'radio:us-kexp:live:d0'), undefined);
assert.equal(corsModeFor(kexp + NO_METER_MARK, false, 'radio:us-kexp:live:d0'), undefined);
console.log('live radio meter flags: all passed');
