import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

test("CLI refuses to overwrite an existing output directory", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "caption-cli-test-"));
  const output = path.join(parent, "existing");
  const marker = path.join(output, "keep.txt");
  try {
    await mkdir(output);
    await writeFile(marker, "SAFE");
    assert.throws(() => execFileSync(process.execPath, [
      "--import", "tsx",
      "tools/captions-daily/cli.mjs",
      "--day", "2026-10-19",
      "--network", "NTD",
      "--out", output,
      "--dry-run",
    ], { encoding: "utf8", stdio: "pipe" }), (error) => {
      assert.equal(error.status, 1);
      assert.match(error.stderr, /output-directory-exists/);
      return true;
    });
    assert.equal(await readFile(marker, "utf8"), "SAFE");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("CLI --selftest runs three synthetic collection days and prints size data only", () => {
  const output = execFileSync(process.execPath, [
    "--import", "tsx",
    "tools/captions-daily/cli.mjs",
    "--selftest",
  ], { encoding: "utf8" });
  const result = JSON.parse(output);
  assert.equal(result.fixture, "synthetic-only");
  assert.equal(result.days.length, 3);
  assert.ok(result.days.every((day) => day.rows > 0 && day.itemsOk === 2 && day.itemsSkipped === 0));
  assert.doesNotMatch(output, /SYNTHETIC SELFTEST/);
});
