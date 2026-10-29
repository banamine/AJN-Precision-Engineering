import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HEATMAP_MAX_ALPHA,
  HEATMAP_NOISE_FLOOR,
  HEATMAP_ROWS,
  binToRows,
  buildHeatmapLut,
  valueToRgba,
} from "./src/utils/heatmapColor";

// --- binToRows -------------------------------------------------------------
const SR = 48000;
const FFT = 2048;
const binHz = SR / FFT; // 23.4375 Hz

assert.equal(binToRows(new Uint8Array(1024), HEATMAP_ROWS, SR, FFT).length, HEATMAP_ROWS);
assert.ok(binToRows(new Uint8Array(1024), HEATMAP_ROWS, SR, FFT).every((v) => v === 0), "silence stays 0");
assert.equal(binToRows([], 8, SR, FFT).length, 8, "empty data still returns rows");
assert.ok(binToRows(new Uint8Array(1024).fill(255), 0, SR, FFT).length === 0, "zero rows -> empty");
assert.ok(binToRows(new Uint8Array(1024).fill(255), 8, 0, FFT).every((v) => v === 0), "bad sample rate -> zeros");

// A single 1 kHz spike must light exactly the row whose band contains 1 kHz, and rows are log-spaced low -> high.
const spike = new Uint8Array(1024);
spike[Math.round(1000 / binHz)] = 200;
const rows = binToRows(spike, HEATMAP_ROWS, SR, FFT);
const lit = Array.from(rows).map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
assert.ok(lit.length >= 1 && lit.length <= 2, `1 kHz spike lit ${lit.length} rows`);
const expectedRow = Math.floor(HEATMAP_ROWS * Math.log(1000 / 40) / Math.log(16000 / 40));
assert.ok(lit.some((i) => Math.abs(i - expectedRow) <= 1), `1 kHz row ${lit} vs expected ${expectedRow}`);
const low = new Uint8Array(1024); low[Math.round(100 / binHz)] = 200;
const high = new Uint8Array(1024); high[Math.round(10000 / binHz)] = 200;
const rowOf = (d: Uint8Array) => Array.from(binToRows(d, HEATMAP_ROWS, SR, FFT)).findIndex((v) => v > 0);
assert.ok(rowOf(low) < rowOf(spike) && rowOf(spike) < rowOf(high), "row order follows frequency");

// Peak per row: loud bin beats quiet neighbours in the same row.
const peak = new Uint8Array(1024).fill(10); peak[500] = 180;
assert.equal(Math.max(...binToRows(peak, HEATMAP_ROWS, SR, FFT)), 180);

// Low sample rate: top rows clamp to Nyquist, never read past the data.
assert.doesNotThrow(() => binToRows(new Uint8Array(512).fill(255), HEATMAP_ROWS, 8000, 1024));

// --- valueToRgba / LUT -------------------------------------------------------
assert.deepEqual(valueToRgba(0), [0, 0, 0, 0], "silence transparent");
assert.deepEqual(valueToRgba(HEATMAP_NOISE_FLOOR), [0, 0, 0, 0], "noise floor transparent");
const quiet = valueToRgba(HEATMAP_NOISE_FLOOR + 5);
assert.ok(quiet[3] > 0 && quiet[3] < 0.3, "just above floor is faint");
const full = valueToRgba(255);
assert.ok(full[3] <= HEATMAP_MAX_ALPHA + 1e-9, "alpha capped");
assert.ok(full[0] > 230 && full[1] > 190 && full[2] < 40, `loudest is yellow, got ${full}`);
const mid = valueToRgba(110);
assert.ok(mid[0] > 200 && mid[1] < 120, `mid-level is red/orange, got ${mid}`);
const lowish = valueToRgba(40);
assert.ok(lowish[2] > lowish[1], `quiet is violet-ish (blue > green), got ${lowish}`);
let prevA = -1;
for (let v = 0; v < 256; v += 1) { const a = valueToRgba(v)[3]; assert.ok(a >= prevA - 1e-9, "alpha never decreases with level"); prevA = a; }
const lut = buildHeatmapLut();
assert.equal(lut.length, 1024);
assert.equal(lut[3], 0, "LUT[0] transparent");
assert.equal(lut[255 * 4 + 3], Math.round(HEATMAP_MAX_ALPHA * 255));

// --- static guards (the player rules, enforced in CI) ----------------------------
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
for (const f of ["./src/components/HeatmapStrip.tsx", "./src/components/PreludeBackdropVideo.tsx", "./src/utils/heatmapColor.ts"]) {
  const src = read(f);
  assert.ok(!/Math\.random/.test(src), `${f}: no Math.random`);
  assert.ok(!/new\s+(webkit)?AudioContext|createMediaElementSource|createAnalyser|createGain|createBufferSource|createOscillator/.test(src), `${f}: creates no Web Audio nodes`);
  assert.ok(!/\.(fftSize|smoothingTimeConstant|minDecibels|maxDecibels)\s*=(?!=)/.test(src), `${f}: never changes analyser settings`);
  assert.ok(!/:\s*any\b|as any\b/.test(src), `${f}: no any`);
}
const player = read("./src/MinimalPlayer.tsx");
const branchStart = player.indexOf("{archiveMusicOn ? (");
const branchEnd = player.indexOf(") : (", branchStart);
assert.ok(branchStart > 0 && branchEnd > branchStart, "archive-music stage branch found");
const archiveBranch = player.slice(branchStart, branchEnd);
assert.ok(archiveBranch.includes("<PreludeBackdropVideo") && archiveBranch.includes("<HeatmapStrip"), "extras mounted inside archive-music branch");
const afterArchive = player.slice(branchEnd);
assert.ok(!afterArchive.includes("<PreludeBackdropVideo") && !afterArchive.includes("<HeatmapStrip"), "extras NOT in live-radio / other branches");
assert.ok(read("./src/components/PreludeBackdropVideo.tsx").includes("muted"), "backdrop video is muted");

console.log("heatmap-color: all checks passed");
