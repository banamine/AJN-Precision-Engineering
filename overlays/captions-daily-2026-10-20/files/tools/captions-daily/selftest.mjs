import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { rotateArchive } from "./archive-store.mjs";
import { collectDay } from "./collector.mjs";
import { parseCsv } from "./csv.mjs";

const days = ["2026-10-17", "2026-10-18", "2026-10-19"];
const srt = "1\r\n00:00:01,000 --> 00:00:02,000\r\nSYNTHETIC SELFTEST FIRST LINE\r\n\r\n2\r\n00:00:11.000 --> 00:00:12.000\r\nSYNTHETIC SELFTEST SECOND LINE\r\n";
const temp = await mkdtemp(path.join(os.tmpdir(), "ajn-captions-selftest-"));
const captionsDir = path.join(temp, "data", "captions");
const sizes = [];
try {
  await mkdir(captionsDir, { recursive: true });
  for (const dayUtc of days) {
    const tvId = `NTD_${dayUtc.replaceAll("-", "")}_120000_SYNTHETIC`;
    const radioId = `The_Alex_Jones_Radio_Show_${dayUtc.replaceAll("-", "")}_120000`;
    const client = {
      async json(url) {
        const parsed = new URL(url);
        if (parsed.pathname === "/advancedsearch.php") {
          return { ok: true, status: 200, body: { response: { numFound: 1, docs: [{ identifier: tvId }] } } };
        }
        if (parsed.pathname === `/metadata/${encodeURIComponent(tvId)}`) {
          return { ok: true, status: 200, body: { metadata: {}, files: [{ name: `${tvId}.align.srt`, private: false }] } };
        }
        throw new Error("unexpected synthetic selftest metadata request");
      },
      async text() { return { ok: true, status: 200, body: srt }; },
    };
    const radioStoreFactory = ({ cacheDir }) => {
      if (cacheDir !== null) throw new Error("selftest radio store must be memory-only");
      const metadata = { metadata: {}, files: [{ name: `${radioId}.asr.srt`, private: false }] };
      return {
        async buildChannel() { return [{ sourceId: radioId, metadata: { durationSeconds: 3600 } }]; },
        cachedItemMetadata(id) { return id === radioId ? metadata : null; },
        getDiagnostics() { return { candidateCount: 1, resolvedItems: 1, scheduleSeconds: 3600, metadataRequests: 1, skippedCount: 0 }; },
      };
    };
    const collected = await collectDay({
      client,
      dayUtc,
      networks: [{ channel: "NTD", codes: ["NTD"] }],
      radioLimit: 1,
      radioStoreFactory,
    });
    const output = await rotateArchive({
      existingDir: captionsDir,
      dayUtc,
      csvBytes: collected.csvBytes,
      stats: collected.stats,
    });
    for (const name of await readdir(captionsDir)) {
      if (/^\d{4}-\d{2}-\d{2}\.csv$/.test(name)) await rm(path.join(captionsDir, name), { force: true });
    }
    for (const [day, bytes] of output.files) await writeFile(path.join(captionsDir, `${day}.csv`), bytes);
    await writeFile(path.join(captionsDir, "MANIFEST.csv"), output.manifest);
    sizes.push({
      dayUtc,
      csvBytes: collected.csvBytes.byteLength,
      rows: collected.stats.rows,
      itemsOk: collected.stats.itemsOk,
      itemsSkipped: collected.stats.itemsSkipped,
    });
    for (const row of collected.rows) row.text = "";
    collected.csvBytes.fill(0);
    for (const bytes of output.files.values()) bytes.fill(0);
    output.manifest.fill(0);
  }
  const manifestBytes = await readFile(path.join(captionsDir, "MANIFEST.csv"));
  const manifestRows = parseCsv(manifestBytes);
  let folderBytes = manifestBytes.byteLength;
  for (const name of await readdir(captionsDir)) {
    if (name.endsWith(".csv") && name !== "MANIFEST.csv") folderBytes += (await readFile(path.join(captionsDir, name))).byteLength;
  }
  process.stdout.write(`${JSON.stringify({
    fixture: "synthetic-only",
    days: sizes,
    manifestBytes: manifestBytes.byteLength,
    folderBytes,
    capBytes: 50_000_000,
    retainedDays: manifestRows.length,
  })}\n`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
