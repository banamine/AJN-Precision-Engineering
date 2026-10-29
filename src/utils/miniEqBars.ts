/**
 * Pure helpers for the mini multicolor equalizer drawn on the cover-art tile.
 * Values come from the SAME analyser data the blue background bars use; nothing here is random or synthetic.
 */

export const MINI_EQ_BAR_COUNT = 24;
/** Only the lower ~45% of bins carry musical energy; the rest is near-empty at typical sample rates. */
const MINI_EQ_BIN_SPAN = 0.45;
const MINI_EQ_CURVE = 1.6;

/** Collapse analyser bins into `count` bars (peak per group), spaced on a power curve so bass gets more bars than treble. Returns 0..255. */
export function miniEqBars(data: ArrayLike<number>, count: number = MINI_EQ_BAR_COUNT): number[] {
  const out: number[] = new Array(Math.max(0, count)).fill(0);
  if (!data.length || count <= 0) return out;
  const span = Math.max(count, Math.floor(data.length * MINI_EQ_BIN_SPAN));
  let prevEnd = 0;
  for (let i = 0; i < count; i += 1) {
    const edge = Math.floor(span * Math.pow((i + 1) / count, MINI_EQ_CURVE));
    const start = Math.min(data.length - 1, prevEnd);
    const end = Math.min(data.length, Math.max(start + 1, edge));
    let peak = 0;
    for (let k = start; k < end; k += 1) if (data[k] > peak) peak = data[k];
    out[i] = peak;
    prevEnd = end;
  }
  return out;
}

/** Hue in degrees for bar `i`: violet -> pink -> red -> orange -> yellow -> green -> cyan -> blue. */
export function miniEqHue(i: number, count: number = MINI_EQ_BAR_COUNT): number {
  const t = count <= 1 ? 0 : i / (count - 1);
  return (280 + t * 300) % 360;
}

/** Share of the tile height the loudest bar may reach: tall when the tile is just an icon, lower when it overlays real artwork. */
export function miniEqMaxHeightFraction(hasImage: boolean): number {
  return hasImage ? 0.48 : 0.85;
}
