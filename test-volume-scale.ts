import assert from 'node:assert/strict';
import { gainFromDial, dialFromGain, stepGain, formatDial, dbFromGain, DIAL_STEP } from './src/utils/volumeScale.ts';
const near = (a: number, b: number, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
near(gainFromDial(25), 1); near(gainFromDial(0), 0); near(gainFromDial(12.5), 0.25);
assert.ok(Math.abs(dbFromGain(gainFromDial(5)) - -27.96) < 0.05, 'dial 5 ≈ −28 dB');
assert.ok(Math.abs(dbFromGain(gainFromDial(15)) - -8.87) < 0.05, 'dial 15 ≈ −8.9 dB');
for (const d of [0, 2.5, 7.5, 12.5, 25]) near(dialFromGain(gainFromDial(d)), d, 1e-9);
// first step from silence is gentle (was a −20 dB jump on the old linear scale)
assert.ok(dbFromGain(stepGain(0, 1)) < -35, 'dial 2.5 ≈ −40 dB');
// stepping walks the 2.5 grid both ways and clamps
let g = 0; const up: string[] = []; for (let i = 0; i < 12; i++) { g = stepGain(g, 1); up.push(formatDial(g)); }
assert.deepEqual(up, ['2.5', '5', '7.5', '10', '12.5', '15', '17.5', '20', '22.5', '25', '25', '25']);
let h = 1; const down: string[] = []; for (let i = 0; i < 4; i++) { h = stepGain(h, -1); down.push(formatDial(h)); }
assert.deepEqual(down, ['22.5', '20', '17.5', '15']);
// an off-grid level snaps to the grid, never skips one
assert.equal(formatDial(stepGain(gainFromDial(13), 1)), '15'); assert.equal(formatDial(stepGain(gainFromDial(13), -1)), '12.5');
assert.equal(stepGain(0, -1), 0); assert.equal(DIAL_STEP, 2.5);
assert.equal(gainFromDial(NaN), 0); assert.equal(dialFromGain(2), 25);
console.log('volumeScale ok');
