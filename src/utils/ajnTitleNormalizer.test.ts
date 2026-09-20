import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeAjnFilename,
  renameLegacyAjnVideoFilename,
} from "./ajnTitleNormalizer";

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

test("renames legacy War Room filenames with positional regex groups", () => {
  assert.equal(
    renameLegacyAjnVideoFilename(
      "VIDEO - 20260729_Wed_WarRoom-Hr3.mp4",
      "WAR-ROOM",
    ),
    "WAR-ROOM 2026-07-29_Wed_WarRoom-Hr3.mp4",
  );
});

test("renames legacy Alex Jones filenames while preserving the extension", () => {
  assert.equal(
    renameLegacyAjnVideoFilename(
      "VIDEO - 20260624_Wed_AlexJones-Hr1.mp4",
      "ALEX-JONES",
    ),
    "ALEX-JONES 2026-06-24_Wed_AlexJones-Hr1.mp4",
  );
});

test("leaves non-matching filenames unchanged", () => {
  assert.equal(
    renameLegacyAjnVideoFilename(
      "WAR-ROOM 2026-07-29_Wed_WarRoom-Hr3.mp4",
      "WAR-ROOM",
    ),
    "WAR-ROOM 2026-07-29_Wed_WarRoom-Hr3.mp4",
  );
});
