import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseCsv, serializeRecords } from "./csv.mjs";
import { DATA_FOLDER_CAP_BYTES, RETENTION_DAYS } from "./collector.mjs";

export const MANIFEST_COLUMNS = Object.freeze([
  "day",
  "bytes",
  "rows",
  "items_ok",
  "items_skipped",
  "reason_counts",
  "sha256",
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function oldStats(day, bytes, oldManifest) {
  const previous = oldManifest?.find((entry) => entry?.day === day);
  if (previous) {
    let reasonCounts = {};
    try { reasonCounts = JSON.parse(previous.reason_counts || "{}"); } catch { reasonCounts = {}; }
    return {
      day,
      bytes: bytes.byteLength,
      rows: Number(previous.rows) || 0,
      items_ok: Number(previous.items_ok) || 0,
      items_skipped: Number(previous.items_skipped) || 0,
      reason_counts: reasonCounts && typeof reasonCounts === "object" ? reasonCounts : {},
      sha256: sha256(bytes),
    };
  }
  const rows = parseCsv(bytes);
  const uniqueItems = new Set(rows.map((row) => `${row.source_kind}\u0000${row.program}`));
  return {
    day,
    bytes: bytes.byteLength,
    rows: rows.length,
    items_ok: uniqueItems.size,
    items_skipped: 0,
    reason_counts: {},
    sha256: sha256(bytes),
  };
}

function manifestBytes(days) {
  const rows = days.map((entry) => ({
    ...entry,
    reason_counts: JSON.stringify(entry.reason_counts ?? {}),
  }));
  return serializeRecords(MANIFEST_COLUMNS, rows);
}

/** Keep complete UTC-day files only; the manifest itself counts toward cap. */
export async function rotateArchive({
  existingDir = null,
  dayUtc,
  csvBytes,
  stats,
  capBytes = DATA_FOLDER_CAP_BYTES,
  retentionDays = RETENTION_DAYS,
  dayBudgetBytes = Math.floor(capBytes / retentionDays),
} = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayUtc)) throw new TypeError("dayUtc must be YYYY-MM-DD.");
  if (!Buffer.isBuffer(csvBytes)) throw new TypeError("csvBytes must be a Buffer.");
  if (!Number.isSafeInteger(capBytes) || capBytes < 1) throw new TypeError("capBytes must be positive.");
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1) throw new TypeError("retentionDays must be positive.");
  if (!Number.isSafeInteger(dayBudgetBytes) || dayBudgetBytes < 1) throw new TypeError("dayBudgetBytes must be positive.");
  if (csvBytes.byteLength > dayBudgetBytes) throw new Error("Current day exceeds its hard day_budget; no files will be written.");

  const files = new Map();
  let oldManifest = null;
  if (existingDir) {
    try {
      oldManifest = parseCsv(await readFile(path.join(existingDir, "MANIFEST.csv")));
    } catch { oldManifest = null; }
    for (const name of await readdir(existingDir).catch(() => [])) {
      const match = /^(\d{4}-\d{2}-\d{2})\.csv$/.exec(name);
      if (!match) continue;
      const filePath = path.join(existingDir, name);
      const fileStat = await stat(filePath).catch(() => null);
      if (!fileStat?.isFile()) continue;
      files.set(match[1], await readFile(filePath));
    }
  }
  files.set(dayUtc, Buffer.from(csvBytes));

  const statsByDay = new Map();
  for (const [day, bytes] of files) {
    if (day === dayUtc) {
      statsByDay.set(day, {
        day,
        bytes: bytes.byteLength,
        rows: Number(stats?.rows) || 0,
        items_ok: Number(stats?.itemsOk) || 0,
        items_skipped: Number(stats?.itemsSkipped) || 0,
        reason_counts: Object.fromEntries(Object.entries(stats?.reasonCounts ?? {}).sort(([a], [b]) => a.localeCompare(b))),
        sha256: sha256(bytes),
      });
    } else statsByDay.set(day, oldStats(day, bytes, oldManifest));
  }

  const ordered = [...files.keys()].sort((a, b) => b.localeCompare(a));
  const keep = new Set(ordered.slice(0, retentionDays));
  for (const day of [...files.keys()]) if (!keep.has(day)) files.delete(day);
  let manifest;
  let totalBytes;
  while (true) {
    const days = [...files.keys()].sort().map((day) => statsByDay.get(day));
    manifest = manifestBytes(days);
    totalBytes = [...files.values()].reduce((sum, bytes) => sum + bytes.byteLength, 0) + manifest.byteLength;
    if (totalBytes <= capBytes) break;
    const oldest = [...files.keys()].filter((day) => day !== dayUtc).sort()[0];
    if (!oldest) throw new Error("manifest + one day exceeds the folder cap; refusing partial output.");
    files.delete(oldest);
  }
  return {
    files,
    manifest,
    manifestBytes: manifest.byteLength,
    totalBytes,
    capBytes,
    dayBudgetBytes,
    retainedDays: [...files.keys()].sort(),
    sha256: Object.fromEntries([...files].map(([day, bytes]) => [day, sha256(bytes)])),
  };
}
