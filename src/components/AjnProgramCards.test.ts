import assert from "node:assert/strict";
import test from "node:test";

const source = `
  <section aria-labelledby="ajn-recent-programs-heading">
    <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory">
      <button aria-label="Play Alex Jones Show">Play</button>
      <button aria-label="Browse Classic Episodes">Browse</button>
    </div>
  </section>
`;

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
