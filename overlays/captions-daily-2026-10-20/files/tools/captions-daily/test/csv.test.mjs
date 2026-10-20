import test from "node:test";
import assert from "node:assert/strict";
import { parseSrt } from "../../../server/captions/captionCore.ts";
import { CSV_COLUMNS, cueRows, mergeCues, parseCsv, serializeCsv } from "../csv.mjs";

test("30-second windows merge consecutive cues without losing text", () => {
  const cues = [
    { start: 0, end: 2, text: "SYNTHETIC ONE" },
    { start: 8, end: 10, text: "SYNTHETIC TWO" },
    { start: 31, end: 33, text: "SYNTHETIC THREE" },
  ];
  const merged = mergeCues(cues);
  assert.deepEqual(merged.map((row) => [row.start, row.end]), [[0, 10], [31, 33]]);
  assert.deepEqual(merged.flatMap((row) => row.text.split("\n")), cues.map((cue) => cue.text));
});

test("a cue crossing a 30-second boundary is not truncated", () => {
  const merged = mergeCues([
    { start: 0, end: 2, text: "SYNTHETIC ONE" },
    { start: 28, end: 34, text: "SYNTHETIC LONG CUE" },
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[1].end, 34);
  assert.equal(merged[1].text, "SYNTHETIC LONG CUE");
});

test("row UTC and source labels remain accurate and explicit", () => {
  const rows = cueRows({
    dayUtc: "2026-10-19",
    sourceKind: "tv",
    channel: "NTD",
    genre: "News",
    program: "SYNTHETIC_PROGRAM_ID",
    itemId: "SYNTHETIC_ID",
    itemStartMs: Date.parse("2026-10-19T12:00:00.000Z"),
    captionKind: "asr",
    cues: [{ start: 12.25, end: 14, text: "SYNTHETIC ASR TEXT" }],
  });
  assert.equal(rows[0].start_utc, "2026-10-19T12:00:12.250Z");
  assert.equal(rows[0].caption_kind, "asr");
  assert.equal(rows[0].machine_generated, "yes");
  assert.equal(rows[0].item_id, "SYNTHETIC_ID");
  assert.equal(rows[0].genre, "News");
  assert.equal(rows[0].start_s, "12.25");
  assert.equal(rows[0].end_s, "14");
  assert.ok(Number.isFinite(Number(rows[0].start_s)));
  assert.ok(Number.isFinite(Number(rows[0].end_s)));
});

test("UTC day boundary values remain exact and are never shifted to local time", () => {
  const before = cueRows({
    dayUtc: "2026-10-19",
    sourceKind: "tv",
    channel: "NTD",
    genre: "News",
    program: "SYNTHETIC_BEFORE",
    itemId: "SYNTHETIC_BEFORE_ID",
    itemStartMs: Date.parse("2026-10-19T23:59:59.000Z"),
    captionKind: "broadcast-cc",
    cues: [{ start: 0, end: 1, text: "SYNTHETIC BEFORE MIDNIGHT" }],
  });
  const after = cueRows({
    dayUtc: "2026-10-20",
    sourceKind: "tv",
    channel: "NTD",
    genre: "News",
    program: "SYNTHETIC_AFTER",
    itemId: "SYNTHETIC_AFTER_ID",
    itemStartMs: Date.parse("2026-10-20T00:00:00.000Z"),
    captionKind: "broadcast-cc",
    cues: [{ start: 0, end: 1, text: "SYNTHETIC AFTER MIDNIGHT" }],
  });
  assert.equal(before[0].start_utc, "2026-10-19T23:59:59.000Z");
  assert.equal(after[0].start_utc, "2026-10-20T00:00:00.000Z");
});

test("CSV is BOM-prefixed, RFC4180 quoted, and round-trips multiline synthetic text", () => {
  const rows = cueRows({
    dayUtc: "2026-10-19",
    sourceKind: "radio",
    channel: "archive-infowars-radio",
    genre: "Talk Radio",
    program: "SYNTHETIC_PROGRAM_ID",
    itemId: "SYNTHETIC_ID",
    itemStartMs: null,
    captionKind: "asr",
    cues: [{ start: 0, end: 2, text: 'SYNTHETIC, "quoted"\nsecond line' }],
  });
  const bytes = serializeCsv(rows);
  assert.equal(bytes.subarray(0, 3).toString("hex"), "efbbbf");
  const parsed = parseCsv(bytes);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].text, 'SYNTHETIC, "quoted"\nsecond line');
  assert.equal(parsed[0].start_utc, "");
  assert.equal(parsed[0].item_id, "SYNTHETIC_ID");
  assert.deepEqual(Object.keys(parsed[0]), [...CSV_COLUMNS]);
  assert.deepEqual(CSV_COLUMNS, [
    "day_utc", "start_utc", "start_s", "end_s", "source_kind", "channel",
    "program", "item_id", "item_url", "caption_kind", "machine_generated", "genre", "text",
  ]);
});

test("caption parser fixture uses invented text and parses both SRT timestamp separators", () => {
  const parsed = parseSrt("\uFEFF1\r\n00:00:01,250 --> 00:00:02.500\r\nSYNTHETIC PARSER CUE\r\n");
  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0], { start: 1.25, end: 2.5, text: "SYNTHETIC PARSER CUE" });
});
