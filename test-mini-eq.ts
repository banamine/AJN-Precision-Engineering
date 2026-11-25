import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MINI_EQ_BAR_COUNT, miniEqBars, miniEqHue, miniEqMaxHeightFraction } from "./src/utils/miniEqBars";

// --- miniEqBars -----------------------------------------------------------------
assert.equal(MINI_EQ_BAR_COUNT, 24);
assert.equal(miniEqBars(new Uint8Array(128)).length, 24);
assert.ok(miniEqBars(new Uint8Array(128)).every((v) => v === 0), "silence -> flat");
assert.equal(miniEqBars([]).length, 24, "empty data still returns bars");
assert.equal(miniEqBars(new Uint8Array(128), 0).length, 0);

// A loud bin lights a bar; bass bins land in lower-index bars than treble bins; values never exceed the input peak.
const bass = new Uint8Array(128); bass[1] = 200;
const mid = new Uint8Array(128); mid[30] = 200;
const high = new Uint8Array(128); high[55] = 200;
const idx = (d: Uint8Array) => miniEqBars(d).findIndex((v) => v > 0);
assert.ok(idx(bass) >= 0 && idx(mid) >= 0 && idx(high) >= 0, "each spike lights a bar");
assert.ok(idx(bass) < idx(mid) && idx(mid) < idx(high), `bar order follows frequency: ${idx(bass)} ${idx(mid)} ${idx(high)}`);
assert.equal(Math.max(...miniEqBars(mid)), 200);
// Every bin below the span edge is covered by some bar (no dead zones).
for (let k = 0; k < Math.floor(128 * 0.45); k += 1) {
  const d = new Uint8Array(128); d[k] = 255;
  assert.ok(miniEqBars(d).some((v) => v === 255), `bin ${k} is covered`);
}
// Small analysers (e.g. 16 bins) still work and never read past the data.
assert.doesNotThrow(() => miniEqBars(new Uint8Array(16).fill(255)));
assert.equal(miniEqBars(new Uint8Array(16).fill(255)).length, 24);

// --- hue / height ------------------------------------------------------------------
assert.equal(miniEqHue(0), 280);
for (let i = 0; i < MINI_EQ_BAR_COUNT; i += 1) { const h = miniEqHue(i); assert.ok(h >= 0 && h < 360); }
assert.equal(new Set(Array.from({ length: 24 }, (_, i) => Math.round(miniEqHue(i)))).size, 24, "24 distinct hues");
assert.equal(miniEqMaxHeightFraction(false), 0.85);
assert.equal(miniEqMaxHeightFraction(true), 0.48);
assert.ok(miniEqMaxHeightFraction(true) < miniEqMaxHeightFraction(false));

// --- static guards ---------------------------------------------------------------------
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
for (const f of ["./src/components/MiniEqVisualizer.tsx", "./src/components/PreludeBackdropVideo.tsx", "./src/utils/miniEqBars.ts"]) {
  const src = read(f);
  assert.ok(!/Math\.random/.test(src), `${f}: no Math.random`);
  assert.ok(!/new\s+(webkit)?AudioContext|createMediaElementSource|createAnalyser|createGain|createBufferSource|createOscillator/.test(src), `${f}: creates no Web Audio nodes`);
  assert.ok(!/\.(fftSize|smoothingTimeConstant|minDecibels|maxDecibels)\s*=(?!=)/.test(src), `${f}: never changes analyser settings`);
  assert.ok(!/:\s*any\b|as any\b/.test(src), `${f}: no any`);
}
const player = read("./src/MinimalPlayer.tsx");
assert.ok(!/HeatmapStrip|heatmap/i.test(player), "orange heat-map fully removed from the player");
const branchStart = player.indexOf("{archiveMusicOn ? (");
const branchEnd = player.indexOf(") : (", branchStart);
assert.ok(branchStart > 0 && branchEnd > branchStart, "archive-music stage branch found");
const archiveBranch = player.slice(branchStart, branchEnd);
assert.ok(archiveBranch.includes("<PreludeBackdropVideo") && archiveBranch.includes("<MiniEqVisualizer"), "extras mounted inside archive-music branch");
assert.ok(!player.slice(branchEnd).includes("<MiniEqVisualizer") && !player.slice(branchEnd).includes("<PreludeBackdropVideo"), "extras NOT in live-radio / other branches");
assert.ok(archiveBranch.includes("analyser={analyserNode}") && archiveBranch.includes("<MiniEqVisualizer analyser={analyserNode}"), "mini EQ wired to the same analyser as the blue bars");
assert.ok(read("./src/components/PreludeBackdropVideo.tsx").includes("muted"), "backdrop video is muted");

console.log("mini-eq: all checks passed");
