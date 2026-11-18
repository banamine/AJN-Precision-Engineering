import assert from 'node:assert/strict';
import { DEFAULT_RADIO_PRESETS, presetProgramId } from './src/utils/radioPresets.ts';
import { liveRadioAllowsMeter, registerLiveRadioMeter } from './src/utils/mediaRoute.ts';

// Factory presets carry no program id; the player must still get the canonical live id the server uses.
const p = DEFAULT_RADIO_PRESETS[4]!;
assert.equal(p.programId, undefined);
assert.equal(presetProgramId(p), 'radio:ch109-classic-rock-109:live:d0');
assert.equal(presetProgramId({ channelId: 'radio:x', programId: 'radio:x:live:d3' }), 'radio:x:live:d3', 'an explicit id is kept');
// With the id, a verified station registered by the preset is allowed the signal meter; without it, never (the bug).
const mem = new Map<string, string>();
const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
registerLiveRadioMeter(p.channelId, storage);
assert.equal(liveRadioAllowsMeter(presetProgramId(p)), true);
assert.equal(liveRadioAllowsMeter(undefined), false);
console.log('radio preset program id tests passed');
