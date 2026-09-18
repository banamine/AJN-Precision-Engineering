import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAjnFilename } from "./ajnTitleNormalizer";

test("decodes a URL-encoded filename and removes extension", () => {
  assert.equal(
    normalizeAjnFilename("https://rss.alexjones.media/foo/Alex%20Jones%20Show_2026-09-17.mp3"),
    "Alex Jones Show 2026 09 17",
  );
});

test("normalizes underscores and hyphens", () => {
  assert.equal(
    normalizeAjnFilename("War-Room__Harrison-Smith.mp3"),
    "War Room Harrison Smith",
  );
});

test("strips query strings and fragments", () => {
  assert.equal(
    normalizeAjnFilename("segment-001.mp3?download=1#media"),
    "segment 001",
  );
});

test("returns an empty string for empty input", () => {
  assert.equal(normalizeAjnFilename(""), "");
});
