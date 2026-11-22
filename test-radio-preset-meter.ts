import { DEFAULT_RADIO_PRESETS, presetProgramId } from './src/utils/radioPresets';
import { corsModeFor, liveRadioAllowsMeter, registerLiveRadioMeter } from './src/utils/mediaRoute';
let fails = 0; const eq = (n: string, a: unknown, b: unknown) => { if (a !== b) { fails++; console.error('FAIL', n, a, b); } };
for (const slot of [3, 4, 5] as const) {
  const p = DEFAULT_RADIO_PRESETS[slot]!;
  // what the old tune() passed: no program id -> no CORS mode -> "Meter unavailable"
  eq(`slot ${slot} old id gives no meter`, liveRadioAllowsMeter(p.programId), false);
  registerLiveRadioMeter(p.channelId, null);
  const pid = presetProgramId(p);
  eq(`slot ${slot} id`, pid, `${p.channelId}:live:d0`);
  eq(`slot ${slot} meter allowed`, liveRadioAllowsMeter(pid), true);
  eq(`slot ${slot} cors mode`, corsModeFor(p.src, false, pid), 'anonymous');
}
console.log(fails ? `FAILED ${fails}` : '[radio-preset-meter] PASS: factory 109 presets get the live id, CORS mode and meter');
process.exit(fails ? 1 : 0);
