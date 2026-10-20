import { createHash } from "node:crypto";
import { lstat, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ArchiveClient, DAILY_REQUEST_CAP, MIN_START_GAP_MS } from "./archive-fetch.mjs";
import { collectDay, DAILY_DAY_BUDGET_BYTES, RADIO_ITEMS_PER_DAY, TV_ADDITIONAL_LAG_DAYS, TV_NETWORKS } from "./collector.mjs";
import { rotateArchive } from "./archive-store.mjs";

const readmePath = fileURLToPath(new URL("./data-branch-readme.md", import.meta.url));
const usage = "node --import tsx tools/captions-daily/cli.mjs [--selftest] [--day YYYY-MM-DD] [--network CHANNEL ...] [--radio-limit N] [--request-cap N] [--existing-dir PATH] [--out PATH] [--dry-run]";
const SAFE_ERROR_CODES = new Set([
  "unknown-argument",
  "invalid-radio-limit",
  "invalid-request-cap",
  "invalid-day",
  "unknown-network",
  "output-must-be-outside-repo",
  "output-directory-exists",
]);

function getArgs(argv) {
  const options = { networks: [], radioLimit: RADIO_ITEMS_PER_DAY, requestCap: DAILY_REQUEST_CAP, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help") { process.stdout.write(`${usage}\n`); process.exit(0); }
    if (arg === "--dry-run") { options.dryRun = true; continue; }
    if (arg === "--selftest") { options.selfTest = true; continue; }
    if (arg === "--day") options.day = argv[++i];
    else if (arg === "--network") options.networks.push(argv[++i]);
    else if (arg === "--radio-limit") options.radioLimit = Number(argv[++i]);
    else if (arg === "--request-cap") options.requestCap = Number(argv[++i]);
    else if (arg === "--existing-dir") options.existingDir = argv[++i];
    else if (arg === "--out") options.outDir = argv[++i];
    else throw new Error("unknown-argument");
  }
  return options;
}

function previousCompleteUtcDay(additionalOffsetDays) {
  const now = new Date();
  const yesterday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 86_400_000;
  return new Date(yesterday - additionalOffsetDays * 86_400_000).toISOString().slice(0, 10);
}

function parseDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""))) throw new Error("invalid-day");
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new Error("invalid-day");
  return value;
}

async function writeArchiveTree(outDir, rotation, readme) {
  await mkdir(path.join(outDir, "data", "captions"), { recursive: true });
  await writeFile(path.join(outDir, "README.md"), readme, "utf8");
  for (const [day, bytes] of rotation.files) await writeFile(path.join(outDir, "data", "captions", `${day}.csv`), bytes);
  await writeFile(path.join(outDir, "data", "captions", "MANIFEST.csv"), rotation.manifest);
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

let tempDir = null;
let csvBytes = null;
let collected = null;
let outputDir = null;
let removeOutput = false;
let client = null;
let rotation = null;
try {
  const options = getArgs(process.argv.slice(2));
  if (options.selfTest) {
    await import("./selftest.mjs");
  } else {
  if (!Number.isInteger(options.radioLimit) || options.radioLimit < 0 || options.radioLimit > RADIO_ITEMS_PER_DAY) throw new Error("invalid-radio-limit");
  if (!Number.isInteger(options.requestCap) || options.requestCap < 1 || options.requestCap > DAILY_REQUEST_CAP) throw new Error("invalid-request-cap");
  const dayUtc = parseDay(options.day || previousCompleteUtcDay(TV_ADDITIONAL_LAG_DAYS));
  const requestedNetworks = options.networks.length
    ? options.networks.map((name) => {
        const match = TV_NETWORKS.find((network) => network.channel.toLowerCase() === String(name).toLowerCase());
        if (!match) throw new Error("unknown-network");
        return match;
      })
    : TV_NETWORKS;
  const existingDir = options.existingDir ? path.resolve(options.existingDir) : null;
  client = new ArchiveClient({ maxRequests: options.requestCap, minGapMs: MIN_START_GAP_MS });
  client.beginPhase("daily", options.requestCap);

  const repoRoot = path.resolve(process.cwd());
  if (options.outDir) {
    outputDir = path.resolve(options.outDir);
    const rel = path.relative(repoRoot, outputDir);
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) throw new Error("output-must-be-outside-repo");
    try {
      await lstat(outputDir);
      throw new Error("output-directory-exists");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  } else {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "ajn-captions-daily-"));
    outputDir = path.join(tempDir, "archive");
  }
  removeOutput = true;

  collected = await collectDay({
    client,
    dayUtc,
    networks: requestedNetworks,
    radioLimit: options.radioLimit,
    dayBudgetBytes: DAILY_DAY_BUDGET_BYTES,
  });
  csvBytes = collected.csvBytes;
  rotation = await rotateArchive({
    existingDir,
    dayUtc,
    csvBytes,
    stats: collected.stats,
  });
  const readme = await (await import("node:fs/promises")).readFile(readmePath, "utf8");
  await writeArchiveTree(outputDir, rotation, readme);
  if (!options.dryRun && options.outDir) removeOutput = false;
  const requestSummary = client.summary();
  const summary = {
    dayUtc,
    networks: requestedNetworks.map((network) => network.channel),
    archivePhysicalStarts: requestSummary.physicalStarts,
    elapsedMs: requestSummary.elapsedMs,
    redirectHops: requestSummary.redirects,
    minimumStartGapMs: requestSummary.measuredMinimumGapMs,
    requestCap: requestSummary.requestCap,
    radioSchedulePrograms: collected.stats.radioSchedulePrograms,
    radioScheduleSeconds: collected.stats.radioScheduleSeconds,
    radioSelectedForArchive: collected.stats.radioSelectedForArchive,
    radioLimit: collected.stats.radioLimit,
    radioItemsOutsideLimit: collected.stats.radioItemsOutsideLimit,
    tvSearches: collected.stats.tvSearches,
    tvItemsFound: collected.stats.tvItemsFound,
    tvMetadataSuccess: collected.stats.tvMetadataSuccess,
    perNetwork: collected.stats.perNetwork,
    itemsOk: collected.stats.itemsOk,
    itemsSkipped: collected.stats.itemsSkipped,
    reasonCounts: collected.stats.reasonCounts,
    rows: collected.stats.rows,
    csvBytes: collected.stats.csvBytes,
    folderBytes: rotation.totalBytes,
    folderCapBytes: rotation.capBytes,
    dayBudgetBytes: rotation.dayBudgetBytes,
    retainedDays: rotation.retainedDays.length,
    sha256DayCsv: digest(csvBytes),
    dryRun: options.dryRun,
    byStatus: requestSummary.byStatus,
    byType: requestSummary.byType,
    bytesReadByType: requestSummary.bytesReadByType,
    requestElapsedMsByType: requestSummary.elapsedMsByType,
  };
  if (options.dryRun) {
    await rm(outputDir, { recursive: true, force: true });
    removeOutput = false;
    summary.tempOutputRemoved = true;
  }
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  }
} catch (error) {
  const clientSummary = client ? client.summary() : null;
  if (outputDir && removeOutput) await rm(outputDir, { recursive: true, force: true }).catch(() => {});
  if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  if (collected?.rows) for (const row of collected.rows) row.text = "";
  if (csvBytes) csvBytes.fill(0);
  const code = error?.code ?? (SAFE_ERROR_CODES.has(error?.message) ? error.message : "run-failed");
  process.stderr.write(`${JSON.stringify({
    errorCode: String(code).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "run-failed",
    archivePhysicalStarts: clientSummary?.physicalStarts ?? 0,
    redirectHops: clientSummary?.redirects ?? 0,
    requestCap: clientSummary?.requestCap ?? null,
    byStatus: clientSummary?.byStatus ?? {},
    byType: clientSummary?.byType ?? {},
  })}\n`);
  process.exitCode = 1;
} finally {
  if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  if (collected?.rows) for (const row of collected.rows) row.text = "";
  if (csvBytes) csvBytes.fill(0);
  if (rotation) {
    for (const bytes of rotation.files.values()) bytes.fill(0);
    rotation.manifest.fill(0);
  }
}
