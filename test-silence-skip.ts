import assert from 'node:assert/strict';
import { SilenceSkipper, SKIP_RATE, compensateDb, EDGE_GUARD_SEC } from './src/utils/silenceSkip.ts';
const f = (o: Partial<Parameters<SilenceSkipper['step']>[0]> = {}) => ({ db: -20, nowMs: 0, position: 100, duration: 3000, rate: 1, ready: true, muted: false, ...o });
// speech: nothing happens
let s = new SilenceSkipper(); for (let t = 0; t < 2000; t += 50) assert.equal(s.step(f({ nowMs: t })), null);
// a pause: the first 500 ms are kept, then 4×, and the normal rate returns the moment sound is back
s = new SilenceSkipper(); let rates: Array<number | null> = [];
for (let t = 0; t <= 600; t += 50) rates.push(s.step(f({ nowMs: t, db: -70 })));
assert.equal(rates.findIndex((r) => r === SKIP_RATE), 10, 'engages at 500 ms'); assert.ok(s.active);
assert.equal(s.step(f({ nowMs: 700, db: -70 })), null, 'stays engaged without re-sending');
assert.equal(s.step(f({ nowMs: 750, db: -30 })), 1, 'sound back -> normal rate'); assert.ok(!s.active);
// hysteresis: between −50 and −46 changes nothing
s = new SilenceSkipper(); for (let t = 0; t <= 600; t += 50) s.step(f({ nowMs: t, db: -70 }));
assert.equal(s.step(f({ nowMs: 700, db: -48 })), null); assert.ok(s.active);
// the listener's own speed (1.5×) is restored, not forced to 1
s = new SilenceSkipper(); for (let t = 0; t <= 600; t += 50) s.step(f({ nowMs: t, db: -70, rate: 1.5 })); assert.equal(s.step(f({ nowMs: 700, db: -30 })), 1.5);
// guards: edges, buffering, muted, unknown duration -> never engages (and releases if it was)
for (const g of [{ position: EDGE_GUARD_SEC - 1 }, { position: 3000 - EDGE_GUARD_SEC + 1 }, { ready: false }, { muted: true }, { duration: Infinity }, { duration: NaN }]) {
  s = new SilenceSkipper(); let hit = false; for (let t = 0; t <= 2000; t += 50) if (s.step(f({ nowMs: t, db: -80, ...g })) === SKIP_RATE) hit = true; assert.ok(!hit, `guard ${JSON.stringify(g)}`);
}
s = new SilenceSkipper(); for (let t = 0; t <= 600; t += 50) s.step(f({ nowMs: t, db: -70 })); assert.equal(s.step(f({ nowMs: 700, db: -70, ready: false })), 1, 'buffering releases');
// a quiet slider is not silence: speech at −20 dB read through a 0.04 element volume (−28 dB) compensates back to ≈ −20
assert.ok(Math.abs(compensateDb(-48, 0.04) - -20.04) < 0.1); assert.equal(compensateDb(-30, 1), -30); assert.ok(compensateDb(-30, 0) < compensateDb(-30, 1) + 41);
console.log('silence skip ok');
