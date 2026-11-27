/* One volume scale for every surface (main player, docks, radio deck, lean-back remote).
 * Listeners think in a 0–25 dial; the element/GainNode takes a gain 0–1. The two are joined by a perceptual (squared) curve:
 *   gain = (dial / 25)²      dial 5 ≈ −28 dB (a real background bed), 15 ≈ −8.5 dB (regular), 25 = full.
 * A linear map made the first 2.5 step a −20 dB jump. What is SAVED stays a plain gain (see dockVolume.ts), so nothing migrates. */
export const DIAL_MAX = 25;
export const DIAL_STEP = 2.5;          // live adjustments (keys, remote, knob): half-steps of 5
export const DIAL_SLIDER_STEP = 0.5;   // sliders: finer
export const DIAL_REGULAR = 15;        // "regular playback" reference

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
export const gainFromDial = (dial: number): number => { const x = clamp(dial, 0, DIAL_MAX) / DIAL_MAX; return x * x; };
export const dialFromGain = (gain: number): number => DIAL_MAX * Math.sqrt(clamp(gain, 0, 1));
export const dbFromGain = (gain: number): number => (gain > 0 ? 20 * Math.log10(gain) : -Infinity);

/** Next gain one dial step up (+1) or down (−1), snapped to the step grid: 15 → 12.5 → 10 …, 0 → 2.5 → 5 … */
export function stepGain(gain: number, dir: 1 | -1, step: number = DIAL_STEP): number {
  const d = dialFromGain(gain);
  const snapped = dir > 0 ? Math.floor(d / step + 1e-6) + 1 : Math.ceil(d / step - 1e-6) - 1;
  return gainFromDial(clamp(snapped * step, 0, DIAL_MAX));
}
/** "12.5" — the dial reading for display and screen readers. */
export const formatDial = (gain: number): string => String(Math.round(dialFromGain(gain) * 2) / 2);
export const dialText = (gain: number): string => `${formatDial(gain)} of ${DIAL_MAX}`;
