import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { serializeCsv } from "../csv.mjs";

test("search uses text in memory but prints no matching caption text", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "caption-search-test-"));
  try {
    const file = serializeCsv([{
      day_utc: "2026-10-19",
      source_kind: "tv",
      channel: "NTD",
      genre: "News",
      program: "SYNTHETIC_PROGRAM",
      start_utc: "",
      start_s: "60",
      end_s: "62",
      caption_kind: "broadcast-cc",
      machine_generated: "no",
      item_id: "SYNTHETIC_ID",
      item_url: "https://archive.org/details/SYNTHETIC_ID",
      text: "SYNTHETIC SECRET PHRASE",
    }]);
    await writeFile(path.join(dir, "2026-10-19.csv"), file);
    const output = execFileSync(process.execPath, [
      "tools/captions-daily/search.mjs",
      "--directory", dir,
      "synthetic secret phrase",
    ], { encoding: "utf8" });
    const parsed = JSON.parse(output);
    assert.equal(parsed.resultCount, 1);
    assert.equal(parsed.results[0].channel, "NTD");
    assert.equal(parsed.results[0].item_url, "https://archive.org/details/SYNTHETIC_ID#t=60");
    assert.doesNotMatch(output, /SYNTHETIC SECRET PHRASE/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
