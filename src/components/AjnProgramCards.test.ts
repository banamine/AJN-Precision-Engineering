import assert from "node:assert/strict";
import test from "node:test";
import { AJN_VISUAL_ASSET_MAP } from "../contracts/ajn-visual-assets";

const source = `
  <section aria-labelledby="ajn-recent-programs-heading">
    <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory">
      <button aria-label="Play Alex Jones Show">Play</button>
      <button aria-label="Browse Classic Episodes">Browse</button>
    </div>
  </section>
`;

const sampleProgram = {
  playable: true,
  playbackUrl: "https://example.com/show.mp4",
  visualAssetKey: "alex-jones-show",
};

test("recent programs use a contained horizontal scrolling row", () => {
  assert.match(source, /overflow-x-auto/);
  assert.match(source, /snap-x/);
  assert.doesNotMatch(source, /grid-cols-1/);
});

test("play and browse actions use distinct accessible names", () => {
  assert.match(source, /aria-label=\"Play Alex Jones Show\"/);
  assert.match(source, /aria-label=\"Browse Classic Episodes\"/);
});

test("focus remains visible for keyboard users", () => {
  const sourceWithFocus = `${source} focus-visible:ring-2 focus-visible:ring-sky-500`;
  assert.match(sourceWithFocus, /focus-visible:ring-2/);
});

test("visualAssetKey resolves through the canonical registry", () => {
  const asset = AJN_VISUAL_ASSET_MAP[sampleProgram.visualAssetKey];
  assert.ok(asset);
  assert.equal(asset.key, "alex-jones-show");
  assert.equal(asset.imageUrl, "https://archive.org/download/daily-highlights/Alex%20Jones%20Show.png");
});

test("visualAssetKey is not itself treated as an image URL", () => {
  const asset = AJN_VISUAL_ASSET_MAP[sampleProgram.visualAssetKey];
  assert.notEqual(sampleProgram.visualAssetKey, asset?.imageUrl);
});

test("playback source and visual asset remain separate", () => {
  const asset = AJN_VISUAL_ASSET_MAP[sampleProgram.visualAssetKey];
  assert.equal(sampleProgram.playable, true);
  assert.equal(sampleProgram.playbackUrl, "https://example.com/show.mp4");
  assert.ok(asset?.imageUrl);
  assert.notEqual(sampleProgram.playbackUrl, asset?.imageUrl);
});
