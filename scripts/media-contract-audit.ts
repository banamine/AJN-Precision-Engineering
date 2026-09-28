import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const baseUrl = process.env.AJN_TEST_URL || "http://localhost:3000";
const out = process.env.MEDIA_CONTRACT_OUT || path.join("media-contract-report");
const librarySample = Math.max(1, Number(process.env.LIBRARY_SAMPLE_COUNT || 100));
const liveTvSample = Math.max(1, Number(process.env.LIVE_TV_SAMPLE_COUNT || 40));

type Entry = { id?: string; title?: string; identifier?: string; path?: string };
type ReportItem = {
  scope: "library" | "live-tv" | "archive-hardcoded";
  id: string;
  title?: string;
  url?: string;
  status: "PASS" | "WARN";
  reason?: string;
  httpStatus?: number | null;
};

type Report = {
  generatedAt: string;
  baseUrl: string;
  librarySample: number;
  liveTvSample: number;
  status: "PASS" | "WARN";
  items: ReportItem[];
};

async function probe(url: string): Promise<{ ok: boolean; status: number | null }> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        Range: "bytes=0-1",
        "User-Agent": "AJN-Precision-Engineering/MediaContractAudit",
      },
      signal: AbortSignal.timeout(15_000),
    });
    await res.body?.cancel().catch(() => {});
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: null };
  }
}

function archiveUrl(raw: string): string | null {
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/download/")) return \`https://archive.org\${raw}\`;
  return null;
}

async function auditLibrary(report: Report): Promise<void> {
  const items: Entry[] = [];
  const seen = new Set<string>();
  let page = 1;

  while (items.length < librarySample) {
    const res = await fetch(\`\${baseUrl}/api/library/items?page=\${page}&limit=48\`, {
      signal: AbortSignal.timeout(30_000),
    }).catch(() => null);

    if (!res || !res.ok) {
      report.status = "WARN";
      report.items.push({
        scope: "library",
        id: \`library-api-page-\${page}\`,
        status: "WARN",
        reason: "library_api_unavailable",
        httpStatus: res?.status ?? null,
      });
      return;
    }

    const body: any = await res.json().catch(() => null);
    const pageItems: Entry[] = Array.isArray(body?.items) ? body.items : [];
    if (!pageItems.length) break;

    for (const item of pageItems) {
      const id = String(item.id ?? item.identifier ?? item.title ?? items.length);
      if (!seen.has(id)) {
        seen.add(id);
        items.push(item);
        if (items.length >= librarySample) break;
      }
    }

    const totalPages = Number(body?.totalPages);
    if (pageItems.length < 48 || (Number.isFinite(totalPages) && page >= totalPages)) break;
    page += 1;
  }

  for (const item of items.slice(0, librarySample)) {
    const id = String(item.id ?? item.identifier ?? item.title ?? "unknown");
    const url = item.path ? archiveUrl(item.path) : null;

    if (!url) {
      report.status = "WARN";
      report.items.push({
        scope: "library",
        id,
        title: item.title,
        status: "WARN",
        reason: "missing_playback_path",
      });
      continue;
    }

    const checked = await probe(url);
    const pass = checked.ok || checked.status === 206;
    if (!pass) report.status = "WARN";

    report.items.push({
      scope: "library",
      id,
      title: item.title,
      url,
      status: pass ? "PASS" : "WARN",
      reason: pass ? undefined : "upstream_unavailable",
      httpStatus: checked.status,
    });
  }
}

function auditHardcodedArchiveLinks(report: Report): void {
  const archiveScript = path.join(process.cwd(), "scripts", "check-archive-links.ts");
  if (!fs.existsSync(archiveScript)) return;

  const links = fs.readFileSync(archiveScript, "utf8")
    .match(/\/download\/[^'"\`\s)]+/g) ?? [];

  for (const link of [...new Set(links)]) {
    report.items.push({
      scope: "archive-hardcoded",
      id: link,
      status: "PASS",
      reason: "covered_by_existing_check_archive_links",
    });
  }
}

function auditLiveTv(report: Report): void {
  const liveOut = path.join(out, "live-tv");
  fs.mkdirSync(liveOut, { recursive: true });

  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(
    command,
    ["tsx", "scripts/live-tv-probe.ts", "--count", String(liveTvSample), "--out", liveOut],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10 * 60 * 1000,
      env: { ...process.env },
    },
  );

  const resultFile = path.join(liveOut, "live-tv-probe.json");
  if (!fs.existsSync(resultFile)) {
    report.status = "WARN";
    report.items.push({
      scope: "live-tv",
      id: "live-tv-probe",
      status: "WARN",
      reason: result.error ? \`probe_process_error: \${result.error.message}\` : "probe_report_missing",
    });
    if (result.stderr) console.error(result.stderr.trim());
    return;
  }

  const payload: any = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  const results: any[] = Array.isArray(payload?.results) ? payload.results : [];

  for (const item of results) {
    const pass = !item.failure || item.failure === "CODEC_UNKNOWN";
    if (!pass) report.status = "WARN";
    report.items.push({
      scope: "live-tv",
      id: String(item.channel ?? item.url ?? "unknown"),
      title: item.channel,
      url: item.url,
      status: pass ? "PASS" : "WARN",
      reason: pass ? undefined : String(item.failure),
      httpStatus: item.manifestStatus ?? null,
    });
  }

  if (results.length === 0) {
    report.status = "WARN";
    report.items.push({
      scope: "live-tv",
      id: "live-tv-empty",
      status: "WARN",
      reason: "no_channels_probed",
    });
  }

  if (result.stderr) console.error(result.stderr.trim());
}

async function main() {
  fs.mkdirSync(out, { recursive: true });

  const report: Report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    librarySample,
    liveTvSample,
    status: "PASS",
    items: [],
  };

  await auditLibrary(report);
  auditHardcodedArchiveLinks(report);
  auditLiveTv(report);

  const output = path.join(out, "media-contract-report.json");
  fs.writeFileSync(output, JSON.stringify(report, null, 2));

  console.log(JSON.stringify({
    status: report.status,
    libraryItems: report.items.filter((x) => x.scope === "library").length,
    hardcodedItems: report.items.filter((x) => x.scope === "archive-hardcoded").length,
    liveTvItems: report.items.filter((x) => x.scope === "live-tv").length,
    output,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
