import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAjnFilename, normalizeLegacyAjnVideoTitle, renameLegacyAjnVideoFilename } from "./ajnTitleNormalizer";

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

test("renames the supplied War Room filename and preserves .mp4", () => {
  assert.equal(
    renameLegacyAjnVideoFilename(
      "VIDEO - 20260729_Wed_WarRoom-Hr3.mp4",
      "WAR-ROOM",
    ),
    "WAR-ROOM 2026-07-29_Wed_WarRoom-Hr3.mp4",
  );
});

test("renames the supplied Alex Jones filename and preserves .mp4", () => {
  assert.equal(
    renameLegacyAjnVideoFilename(
      "VIDEO - 20260624_Wed_AlexJones-Hr1.mp4",
      "ALEX-JONES",
    ),
    "ALEX-JONES 2026-06-24_Wed_AlexJones-Hr1.mp4",
  );
});

test("infers prefixes for the shared AJNHourlyVideo feed", () => {
  assert.equal(
    normalizeLegacyAjnVideoTitle("VIDEO - 20260729_Wed_WarRoom-Hr3.mp4"),
    "WAR-ROOM 2026-07-29_Wed_WarRoom-Hr3.mp4",
  );
  assert.equal(
    normalizeLegacyAjnVideoTitle("VIDEO - 20260729_Wed_Alex-Hr4.mp4"),
    "ALEX-JONES 2026-07-29_Wed_Alex-Hr4.mp4",
  );
});

test("uses the URL filename when the RSS title is generic", () => {
  assert.equal(
    normalizeLegacyAjnVideoTitle(
      "AJN Hourly Video",
      "https://example.invalid/VIDEO%20-%2020260729_Wed_WarRoom-Hr3.mp4",
    ),
    "WAR-ROOM 2026-07-29_Wed_WarRoom-Hr3.mp4",
  );
});

test("leaves nonmatching filenames unchanged", () => {
  assert.equal(
    renameLegacyAjnVideoFilename(
      "WAR-ROOM 2026-07-29_Wed_WarRoom-Hr3.mp4",
      "WAR-ROOM",
    ),
    "WAR-ROOM 2026-07-29_Wed_WarRoom-Hr3.mp4",
  );
});
