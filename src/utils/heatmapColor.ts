/**
 * Pure helpers for the archive-music heat-map strip (rolling spectrogram).
 * No audio nodes, no randomness: every value comes from an AnalyserNode's byte frequency data.
 */

export const HEATMAP_ROWS = 64;
export const HEATMAP_MIN_HZ = 40;
export const HEATMAP_MAX_HZ = 16000;
/** Analyser byte values at or below this are treated as silence and drawn fully transparent. */
export const HEATMAP_NOISE_FLOOR = 20;
/** Cap so the strip never overpowers the existing bars or the title text. */
export const HEATMAP_MAX_ALPHA = 0.8;

type Rgb = readonly [number, number, number];
const STOPS: ReadonlyArray<{ at: number; rgb: Rgb }> = [
  { at: 0, rgb: [40, 10, 80] }, // violet
  { at: 0.4, rgb: [220, 38, 38] }, // red
  { at: 0.7, rgb: [249, 115, 22] }, // orange
  { at: 1, rgb: [250, 204, 21] }, // yellow
];

/**
 * Collapse linear analyser bins into `rows` log-spaced frequency rows (peak per row).
 * Row 0 is the lowest band (HEATMAP_MIN_HZ), the last row the highest (HEATMAP_MAX_HZ, clamped to Nyquist).
 */
export function binToRows(
  data: ArrayLike<number>,
  rows: number,
  sampleRate: number,
  fftSize: number,
  minHz: number = HEATMAP_MIN_HZ,
  maxHz: number = HEATMAP_MAX_HZ,
): Uint8Array {
  const out = new Uint8Array(Math.max(0, rows));
  if (!data.length || rows <= 0 || sampleRate <= 0 || fftSize <= 0 || minHz <= 0 || maxHz <= minHz) return out;
  const binHz = sampleRate / fftSize;
  const nyquist = sampleRate / 2;
  const top = Math.min(maxHz, nyquist);
  if (top <= minHz) return out;
  const ratio = top / minHz;
  for (let r = 0; r < rows; r += 1) {
    const lo = minHz * Math.pow(ratio, r / rows);
    const hi = minHz * Math.pow(ratio, (r + 1) / rows);
    const start = Math.min(data.length - 1, Math.max(0, Math.floor(lo / binHz)));
    const end = Math.min(data.length, Math.max(start + 1, Math.ceil(hi / binHz)));
    let peak = 0;
    for (let i = start; i < end; i += 1) if (data[i] > peak) peak = data[i];
    out[r] = peak;
  }
  return out;
}

/** Byte value 0..255 -> [r, g, b, alpha 0..1]. Silence is fully transparent. */
export function valueToRgba(v: number): [number, number, number, number] {
  if (!(v > HEATMAP_NOISE_FLOOR)) return [0, 0, 0, 0];
  const t = Math.min(1, (v - HEATMAP_NOISE_FLOOR) / (255 - HEATMAP_NOISE_FLOOR));
  let i = 1;
  while (i < STOPS.length - 1 && t > STOPS[i].at) i += 1;
  const a = STOPS[i - 1];
  const b = STOPS[i];
  const k = (t - a.at) / (b.at - a.at);
  const mix = (c: number) => Math.round(a.rgb[c] + (b.rgb[c] - a.rgb[c]) * k);
  return [mix(0), mix(1), mix(2), HEATMAP_MAX_ALPHA * Math.min(1, t / 0.25)];
}

/** 256-entry RGBA lookup table (alpha scaled to 0..255) so drawing a column is allocation-free. */
export function buildHeatmapLut(): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let v = 0; v < 256; v += 1) {
    const [r, g, b, a] = valueToRgba(v);
    lut[v * 4] = r;
    lut[v * 4 + 1] = g;
    lut[v * 4 + 2] = b;
    lut[v * 4 + 3] = Math.round(a * 255);
  }
  return lut;
}
