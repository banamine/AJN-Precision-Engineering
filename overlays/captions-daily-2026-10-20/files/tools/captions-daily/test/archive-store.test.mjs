import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MANIFEST_COLUMNS, rotateArchive } from "../archive-store.mjs";
import { parseCsv, serializeCsv } from "../csv.mjs";

function fixture(day, marker) {
  return serializeCsv([{
    day_utc: day,
    source_kind: "tv",
    channel: "NTD",
    genre: "News",
    program: `SYNTHETIC_${marker}`,
    start_utc: "",
    start_s: "0",
    end_s: "1",
    caption_kind: "broadcast-cc",
    machine_generated: "no",
    item_url: "https://archive.org/details/SYNTHETIC_ID",
    text: `SYNTHETIC ${marker}`,
  }]);
}

test("same-day reruns with identical inputs are byte-for-byte idempotent", async () => {
  const bytes = fixture("2026-10-19", "DAY_ONE");
  const options = { dayUtc: "2026-10-19", csvBytes: bytes, stats: { rows: 1, itemsOk: 1, itemsSkipped: 0, reasonCounts: {} }, capBytes: 100_000, retentionDays: 7, dayBudgetBytes: 10_000 };
  const first = await rotateArchive(options);
  const second = await rotateArchive(options);
  assert.deepEqual(first.manifest, second.manifest);
  assert.deepEqual([...first.files], [...second.files]);
  assert.deepEqual(first.sha256, second.sha256);
  const manifestRows = parseCsv(first.manifest);
  assert.deepEqual(Object.keys(manifestRows[0]), [...MANIFEST_COLUMNS]);
  assert.equal(manifestRows[0].day, "2026-10-19");
  assert.equal(manifestRows[0].sha256, first.sha256["2026-10-19"]);
});

test("rotation removes oldest whole days and preserves the newest seven", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "caption-rotation-test-"));
  try {
    const captionsDir = path.join(dir, "captions");
    await mkdir(captionsDir, { recursive: true });
    for (let day = 1; day <= 8; day += 1) {
      const date = `2026-10-${String(day).padStart(2, "0")}`;
      await writeFile(path.join(captionsDir, `${date}.csv`), fixture(date, `DAY_${day}`));
    }
    const current = fixture("2026-10-09", "DAY_NINE");
    const output = await rotateArchive({
      existingDir: captionsDir,
      dayUtc: "2026-10-09",
      csvBytes: current,
      stats: { rows: 1, itemsOk: 1, itemsSkipped: 0, reasonCounts: {} },
      capBytes: 1_000_000,
      retentionDays: 7,
      dayBudgetBytes: 100_000,
    });
    assert.equal(output.retainedDays.length, 7);
    assert.deepEqual(output.retainedDays, [
      "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06",
      "2026-10-07", "2026-10-08", "2026-10-09",
    ]);
    assert.equal(output.totalBytes, [...output.files.values()].reduce((sum, bytes) => sum + bytes.byteLength, 0) + output.manifestBytes);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("manifest and retained data are included at the folder-cap boundary", async () => {
  const bytes = fixture("2026-10-19", "CAP");
  const stats = { rows: 1, itemsOk: 1, itemsSkipped: 0, reasonCounts: {} };
  const initial = await rotateArchive({ dayUtc: "2026-10-19", csvBytes: bytes, stats, capBytes: 100_000, dayBudgetBytes: 50_000 });
  const exactBoundary = await rotateArchive({
    dayUtc: "2026-10-19", csvBytes: bytes, stats,
    capBytes: initial.totalBytes, dayBudgetBytes: 50_000,
  });
  assert.ok(exactBoundary.totalBytes <= initial.totalBytes);
  assert.equal(exactBoundary.files.get("2026-10-19").byteLength, bytes.byteLength);
  assert.ok(exactBoundary.manifestBytes > 0);
});

test("the oldest whole day is removed when the cap requires it", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "caption-cap-test-"));
  try {
    const captionsDir = path.join(dir, "captions");
    await mkdir(captionsDir, { recursive: true });
    const old = fixture("2026-10-18", "OLD");
    await writeFile(path.join(captionsDir, "2026-10-18.csv"), old);
    const current = fixture("2026-10-19", "CURRENT");
    const oneDay = await rotateArchive({
      dayUtc: "2026-10-19", csvBytes: current,
      stats: { rows: 1, itemsOk: 1, itemsSkipped: 0, reasonCounts: {} },
      capBytes: 100_000, retentionDays: 7, dayBudgetBytes: 10_000,
    });
    const cap = oneDay.totalBytes + old.byteLength - 1;
    const output = await rotateArchive({
      existingDir: captionsDir,
      dayUtc: "2026-10-19",
      csvBytes: current,
      stats: { rows: 1, itemsOk: 1, itemsSkipped: 0, reasonCounts: {} },
      capBytes: cap,
      retentionDays: 7,
      dayBudgetBytes: 10_000,
    });
    assert.deepEqual(output.retainedDays, ["2026-10-19"]);
    assert.ok(output.totalBytes <= cap);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("manifest plus one day over cap fails loudly; oversized day is rejected", async () => {
  const bytes = fixture("2026-10-19", "TOO_LARGE");
  const stats = { rows: 1, itemsOk: 1, itemsSkipped: 0, reasonCounts: {} };
  await assert.rejects(rotateArchive({
    dayUtc: "2026-10-19",
    csvBytes: bytes,
    stats,
    capBytes: 50,
    retentionDays: 7,
    dayBudgetBytes: 1000,
  }), /manifest \+ one day exceeds the folder cap/);
  await assert.rejects(rotateArchive({
    dayUtc: "2026-10-19",
    csvBytes: bytes,
    stats,
    capBytes: 100_000,
    retentionDays: 7,
    dayBudgetBytes: 10,
  }), /exceeds its hard day_budget/);
});
