import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cleanAjnDisplayTitle, normalizeAjnFilename } from "./ajnTitleNormalizer";

type TitleCase = [before: string, after: string];
const realTitleCases = JSON.parse(
  readFileSync("src/utils/ajn-title-cleaning-real-cases.json", "utf8"),
) as TitleCase[];

assert.equal(realTitleCases.length, 60, "the fixed fixture must contain 60 corpus-derived title pairs");

for (const [index, [before, after]] of realTitleCases.entries()) {
  test(`cleans corpus title ${index + 1} without changing its expected display identity`, () => {
    assert.equal(cleanAjnDisplayTitle(before), after);
  });
}

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

test("preserves punctuation-bearing names and identity markers", () => {
  assert.equal(cleanAjnDisplayTitle("M*A*S*H: (No Laugh Track)"), "M*A*S*H: (No Laugh Track)");
  assert.equal(cleanAjnDisplayTitle("Mr. & Mrs. Smith"), "Mr. & Mrs. Smith");
  assert.equal(cleanAjnDisplayTitle("The Show (1966) — Part 2"), "The Show (1966) — Part 2");
  assert.equal(cleanAjnDisplayTitle("Stroker & Hoop —"), "Stroker & Hoop");
  assert.equal(cleanAjnDisplayTitle("Charlie's Show (1)"), "Charlie's Show (1)");
});

test("decodes entities, normalizes episode markers, and preserves calendar dates", () => {
  assert.equal(cleanAjnDisplayTitle("The&amp; Show - Season 1 Episode 2"), "The& Show - S01E02");
  assert.equal(cleanAjnDisplayTitle("EVEN STEVENS - S01 E01 - Swap.com (480p - Web-DL)"), "EVEN STEVENS - S01E01");
  assert.equal(cleanAjnDisplayTitle("The Movie 21 Oct 1963"), "The Movie 21 Oct 1963");
  assert.equal(cleanAjnDisplayTitle("The Movie October 21, 1963"), "The Movie October 21, 1963");
  assert.equal(cleanAjnDisplayTitle("A Film 1966"), "A Film (1966)");
  assert.equal(cleanAjnDisplayTitle("A Film 1x2"), "A Film S01E02");
});

test("keeps malformed encoding intact and removes a lowercase Archive suffix only", () => {
  assert.equal(cleanAjnDisplayTitle("Bad%ZZTitle ia"), "Bad%ZZTitle");
  assert.equal(cleanAjnDisplayTitle("A title IA"), "A title IA");
});
