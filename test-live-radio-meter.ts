import assert from 'node:assert/strict';
import { corsModeFor, liveRadioAllowsMeter, registerLiveRadioMeter, NO_METER_MARK } from './src/utils/mediaRoute.ts';
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
// bulk-directory stations: unknown until the Radio panel registers them (server said corsVerified); then the same CORS rule applies
const bulk = 'radio:rb-0a1b2c3d-0000-4000-8000-000000000001';
assert.equal(liveRadioAllowsMeter(`${bulk}:live:d0`), false);
registerLiveRadioMeter(bulk);
assert.equal(liveRadioAllowsMeter(`${bulk}:live:d0`), true);
assert.equal(corsModeFor('https://example.org/s.mp3', false, `${bulk}:live:d0`), 'anonymous');
assert.equal(corsModeFor('https://example.org/s.mp3' + NO_METER_MARK, false, `${bulk}:live:d0`), undefined);
assert.equal(liveRadioAllowsMeter(`${bulk}x:live:d0`), false, 'prefix must match the whole station id');
registerLiveRadioMeter('not a station id'); registerLiveRadioMeter('radio:');
assert.equal(liveRadioAllowsMeter('not a station id:live:d0'), false);
console.log('live radio meter flags: all passed');

// reload survival: registered ids are written to storage, read back defensively, capped, and junk is ignored
{
  const { readStoredMeterIds, writeStoredMeterIds, METER_RADIO_STORAGE_KEY } = await import('./src/utils/mediaRoute.ts');
  const data: Record<string, string> = {};
  const mem = { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; } };
  assert.deepEqual(readStoredMeterIds(mem), []);
  const a = 'radio:rb-aaaa-1', b = 'radio:rb-bbbb-2';
  registerLiveRadioMeter(a, mem); registerLiveRadioMeter(b, mem); registerLiveRadioMeter(a, mem); // repeat must not duplicate
  assert.deepEqual(readStoredMeterIds(mem), [a, b]);
  data[METER_RADIO_STORAGE_KEY] = JSON.stringify([a, 'bad id', 7, null, 'radio:ok']);
  assert.deepEqual(readStoredMeterIds(mem), [a, 'radio:ok'], 'junk entries dropped');
  for (const bad of ['not json', '{"a":1}', '"x"']) { data[METER_RADIO_STORAGE_KEY] = bad; assert.deepEqual(readStoredMeterIds(mem), [], bad); }
  writeStoredMeterIds(Array.from({ length: 500 }, (_, i) => `radio:s${i}`), mem);
  assert.equal(readStoredMeterIds(mem).length, 300);
  assert.equal(readStoredMeterIds(mem).at(-1), 'radio:s499', 'newest kept');
  const throwing = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
  assert.deepEqual(readStoredMeterIds(throwing), []); writeStoredMeterIds([a], throwing); registerLiveRadioMeter('radio:rb-cccc-3', throwing); // no throw
  assert.equal(liveRadioAllowsMeter('radio:rb-cccc-3:live:d0'), true, 'still registered in memory when storage fails');
  console.log('live radio meter storage: all passed');
}
