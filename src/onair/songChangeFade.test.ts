import assert from 'node:assert';
import { AJN_PLAYOUT as E } from './engine.js';
import { DEFAULT_PARAMS } from './runOfShow';

const p: any = { ...DEFAULT_PARAMS };
const start = 1_000_000;
const change = start + 400_000; // inside the 330-570 s window
const ex = E.musicExitAtMs(start, p, [change], false, 'Live 109', null);
assert.strictEqual(ex.reason, 'song_change');
const fadeMs = p.musicFadeOutSec * 1000;
const fadeStart = ex.exitAtMs - fadeMs;
// The fade must not already be over at the moment the change is seen, and must run its full length.
assert.ok(fadeStart >= change, 'fade starts at or after the song change, not before it');
assert.strictEqual(ex.exitAtMs - fadeStart, fadeMs);
// Leaves the standby deck its load time before the fade begins.
assert.ok(fadeStart - change >= (p.standbyLoadSec || 6) * 1000);
// No song change in the window still falls back to the timer.
const t = E.musicExitAtMs(start, p, [], false, 'Live 109', null);
assert.strictEqual(t.reason, 'hard_timer_max');
console.log('songChangeFade: ok');
