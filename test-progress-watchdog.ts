import assert from 'node:assert/strict';
import { createProgressWatchdog, type WatchdogSample } from './src/utils/progressWatchdog';
let t = 0; let stalls = 0; let s: WatchdogSample = { wantsPlay: true, readyState: 1, currentTime: 0, bufferedEnd: 0 };
const wd = createProgressWatchdog({ stallMs: 8000, sample: () => s, onStall: () => { stalls++; }, now: () => t });
const run = (sec: number) => { for (let i = 0; i < sec; i++) { t += 1000; wd.tick(); } };
run(7); assert.equal(stalls, 0, 'not before 8 s');
run(2); assert.equal(stalls, 1, 'fires once at 8 s with no progress and no events');
run(7); assert.equal(stalls, 1); run(2); assert.equal(stalls, 2, 'fires again after another 8 s (retry budget lives in scheduleRecover)');
// progress (buffer grows) resets the clock
s = { wantsPlay: true, readyState: 1, currentTime: 0, bufferedEnd: 1 }; run(1); run(7); assert.equal(stalls, 2);
// healthy playback never fires
let ct = 5; const healthy = () => { ct += 1; s = { wantsPlay: true, readyState: 4, currentTime: ct, bufferedEnd: ct + 3 }; };
for (let i = 0; i < 30; i++) { healthy(); t += 1000; wd.tick(); } assert.equal(stalls, 2, 'a moving playhead never fires');
// frozen at readyState 4 (Chrome live stream, silent, no event): stalled
s = { wantsPlay: true, readyState: 4, currentTime: ct, bufferedEnd: ct + 3 }; run(1); run(9); assert.equal(stalls, 3, 'frozen at readyState 4 is stalled');
// paused (user did not ask) never fires
s = { wantsPlay: false, readyState: 0, currentTime: 0, bufferedEnd: 0 }; run(60); assert.equal(stalls, 3);
// ready 3 but playhead 0 and frozen: stalled
s = { wantsPlay: true, readyState: 3, currentTime: 0, bufferedEnd: 2 }; run(1); run(9); assert.equal(stalls, 4);
console.log('PASS progress watchdog');
