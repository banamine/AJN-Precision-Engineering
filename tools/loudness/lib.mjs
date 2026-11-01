// Pure helpers for the loudness batch (no ffmpeg calls here, so they are unit-testable).
export const DEFAULTS = { lufs: -16, tp: -1.5, lra: 11, tolerance: 0.5, tpTolerance: 0.1, maxGain: 12, silenceBelow: -50, lraReview: 15 };

/** loudnorm prints one JSON object (all values are strings, "-inf" possible). Returns numbers or null. */
export function parseLoudnormJson(stderr) {
  const blocks = String(stderr).match(/\{[^{}]*\}/g);
  if (!blocks) return null;
  let raw; try { raw = JSON.parse(blocks[blocks.length - 1]); } catch { return null; }
  const n = (v) => { const x = Number.parseFloat(v); return Number.isFinite(x) ? x : null; };
  return { i: n(raw.input_i), tp: n(raw.input_tp), lra: n(raw.input_lra), thresh: n(raw.input_thresh), offset: n(raw.target_offset), type: raw.normalization_type ?? null, outI: n(raw.output_i), outTp: n(raw.output_tp), outLra: n(raw.output_lra) };
}

/** Decide what to do with a measured input. Never guesses: unmeasurable/silent/huge-gain files are sent to review, not processed. */
export function planFor(m, o = DEFAULTS) {
  if (!m || m.i === null || m.tp === null) return { action: 'review', reason: 'unmeasurable (silence or unreadable audio)' };
  if (m.i < o.silenceBelow) return { action: 'review', reason: `near-silent input (${m.i} LUFS)` };
  const gain = round2(o.lufs - m.i);
  if (Math.abs(gain) > o.maxGain) return { action: 'review', reason: `gain ${gain} dB exceeds +-${o.maxGain} dB`, gain };
  if (Math.abs(gain) < 0.05) return { action: 'copy-ok', gain, method: 'none', reason: 'already on target' };
  if (m.tp + gain <= o.tp) return { action: 'process', method: 'constant-gain', gain };
  return { action: 'process', method: 'loudnorm-2pass-linear', gain };
}

/** Pass/fail on the RE-MEASURED output. */
export function evaluate(out, o = DEFAULTS) {
  const reasons = [];
  if (!out || out.i === null || out.tp === null) return { ok: false, reasons: ['output could not be measured'] };
  if (Math.abs(out.i - o.lufs) > o.tolerance) reasons.push(`integrated ${out.i} LUFS is more than ${o.tolerance} LU from ${o.lufs}`);
  if (out.tp > o.tp + o.tpTolerance) reasons.push(`true peak ${out.tp} dBTP is above ${o.tp} (+${o.tpTolerance})`);
  return { ok: reasons.length === 0, reasons };
}

export function median(a) { const s = [...a].sort((x, y) => x - y); const k = s.length >> 1; return s.length ? (s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2) : null; }
/** Files whose INPUT loudness is far from the rest of the batch (robust: median + MAD). Needs >= 5 files. */
export function outliers(items, minLU = 6) {
  const vals = items.filter((x) => x.i !== null).map((x) => x.i);
  if (vals.length < 5) return new Set();
  const med = median(vals); const mad = median(vals.map((v) => Math.abs(v - med))) || 0.5;
  return new Set(items.filter((x) => x.i !== null && Math.abs(x.i - med) > Math.max(minLU, 3 * 1.4826 * mad)).map((x) => x.key));
}
export const round2 = (x) => Math.round(x * 100) / 100;
export const CSV_COLUMNS = ['file', 'status', 'method', 'gain_db', 'in_lufs', 'in_tp', 'in_lra', 'out_lufs', 'out_tp', 'out_lra', 'flags', 'reasons', 'sha256_original', 'ffmpeg', 'target_lufs', 'target_tp', 'time'];
export const csvCell = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
