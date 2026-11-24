import test from 'node:test';
import assert from 'node:assert/strict';
import { LevelEstimator, levelKey, rmsDb, slewTrim, trimFor, MIN_TRIM, TARGET_DB, relativeTrim, outputDb, MUSIC_OVER_DB, musicTrimNext, musicCreepNext } from './loudness';

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

test('music is matched to the podcast it follows: at most MUSIC_OVER_DB above it, never boosted, floor applies', () => {
  const podOut = outputDb(-26, 1); // podcast heard at -26 dB
  const t = relativeTrim(-14, podOut);
  assert.ok(Math.abs(outputDb(-14, t) - (podOut + MUSIC_OVER_DB)) < 0.01);
  assert.equal(relativeTrim(-40, podOut), 1);
  assert.equal(relativeTrim(0, -60), MIN_TRIM);
});
test('slow music slew: 1.5 dB per second', () => {
  const a = slewTrim(1, 0.1, 1, 1.5);
  assert.ok(Math.abs(20 * Math.log10(a) + 1.5) < 0.01);
});

test('owner rule: music may sit 3 dB above the podcast it follows', () => { assert.equal(MUSIC_OVER_DB, 3); });
test('music rises and stays: once settled the trim never goes down; before settling it may move to the real level', () => {
  // settled: a lower target is ignored, a higher one is followed slowly
  assert.equal(musicTrimNext(0.5, 0.2, 1, true), 0.5);
  assert.ok(musicTrimNext(0.3, 0.6, 1, true) > 0.3);
  // not settled (guess phase): follows the target either way, at the slow music rate (1.5 dB/s)
  const down = musicTrimNext(0.5, 0.2, 1, false);
  assert.ok(down < 0.5 && Math.abs(20 * Math.log10(down / 0.5) + 1.5) < 0.01);
  assert.ok(musicTrimNext(0.3, 0.6, 1, false) > 0.3);
});
test('simulated music block: 40 s of wobbling measurements never lowers the level after it is settled', () => {
  let applied = relativeTrim(-14, outputDb(-26, 1)) * Math.pow(10, -6 / 20), settled = false, measured = false, prev = applied, steps = 0;
  const e = new LevelEstimator();
  for (let i = 0; i < 400; i++) {                                   // 0.1 s ticks
    const raw = -11 + 3 * Math.sin(i / 7);                          // real music: louder than the -14 guess, wobbling +-3 dB
    e.add(raw, 0.1); const lvl = e.get();
    let target = relativeTrim(-14, outputDb(-26, 1));
    if (lvl !== null) { target = relativeTrim(lvl, outputDb(-26, 1)); measured = true; }
    applied = musicTrimNext(applied, target, 0.1, settled);
    if (measured && applied === target) settled = true;
    if (settled) { assert.ok(applied >= prev - 1e-12, 'level went down after settling at tick ' + i); steps++; }
    prev = applied;
  }
  assert.ok(steps > 100);
});
test('the music starts 6 dB under its guess, so a louder-than-guessed track is only ever raised or held, not pulled back down', () => {
  const guess = relativeTrim(-14, outputDb(-26, 1)), start = guess * Math.pow(10, -6 / 20);
  const real = relativeTrim(-12.5, outputDb(-26, 1)); // real music 1.5 dB louder than the guess: target 1.5 dB lower than the guess
  assert.ok(real < guess && start < real);               // still above the start: it rises into the real level
});

{ // settled music keeps creeping up to full level, slowly, never down
  let a = 0.2; let prev = a;
  for (let i = 0; i < 4000; i++) { a = musicCreepNext(a, 0.1); assert.ok(a >= prev); prev = a; }
  assert.equal(a, 1);
  const one = musicCreepNext(0.2, 1); assert.ok(one > 0.2 && one < 0.22, 'about 0.25 dB per second');
  assert.equal(musicCreepNext(1, 1), 1);
  console.log('music creep tests ok');
}
