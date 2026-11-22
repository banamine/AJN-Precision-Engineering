import test from 'node:test';
import assert from 'node:assert/strict';
import { LevelEstimator, levelKey, rmsDb, slewTrim, trimFor, MIN_TRIM, TARGET_DB } from './loudness';

test('rmsDb: full-scale square is 0 dB, half amplitude is about -6 dB, silence is -120', () => {
  assert.ok(Math.abs(rmsDb([1, -1, 1, -1])) < 0.01);
  assert.ok(Math.abs(rmsDb([0.5, -0.5, 0.5, -0.5]) + 6.02) < 0.05);
  assert.equal(rmsDb([0, 0, 0]), -120);
});
test('trim: loud sources are lowered, quiet ones are left alone (never boosted), floor applies', () => {
  assert.ok(Math.abs(trimFor(-12) - 0.2512) < 0.002); // -12 dB source -> -12 dB trim to reach -24
  assert.equal(trimFor(-30), 1); assert.equal(trimFor(TARGET_DB), 1);
  assert.equal(trimFor(0), MIN_TRIM);
});
test('estimator: needs 5 s of real sound, ignores silence, averages levels', () => {
  const e = new LevelEstimator();
  for (let i = 0; i < 40; i++) e.add(-12, 0.1); assert.equal(e.get(), null);
  for (let i = 0; i < 20; i++) e.add(-100, 0.1); assert.equal(e.get(), null); // silence not counted
  for (let i = 0; i < 20; i++) e.add(-12, 0.1);
  assert.ok(Math.abs((e.get() as number) + 12) < 0.01);
});
test('slew moves at most 4 dB per second and lands exactly on the target', () => {
  const a = slewTrim(1, 0.1, 0.1); // wants -20 dB, may move 0.4 dB
  assert.ok(Math.abs(20 * Math.log10(a) + 0.4) < 0.01);
  assert.equal(slewTrim(0.5, 0.49, 0.1), 0.49);
  assert.ok(slewTrim(0.1, 1, 0.1) > 0.1);
});
test('level keys: one per podcast/filler show, shared for live and library music', () => {
  assert.equal(levelKey('live', 'Music Block 3'), 'live'); assert.equal(levelKey('library', 'x'), 'library');
  assert.equal(levelKey('podcast', ' Fox  News '), 'podcast:fox news'); assert.equal(levelKey(null, 'x'), null);
});
