import fs from "node:fs";
import path from "node:path";

const baseUrl = process.env.AJN_TEST_URL || "http://localhost:3000";
const out = process.env.MEDIA_CONTRACT_OUT || path.join("media-contract-report");
const librarySample = Math.max(1, Number(process.env.LIBRARY_SAMPLE_COUNT || 100));

type Entry = { id?: string; title?: string; identifier?: string; path?: string };
type ReportItem = {
  scope: "library" | "archive-hardcoded";
  id: string;
  title?: string;
  url?: string;
  status: "PASS" | "WARN";
  reason?: string;
  httpStatus?: number | null;
};

async function probe(url: string): Promise<{ ok: boolean; status: number | null }> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { Range: "bytes=0-1", "User-Agent": "AJN-Precision-Engineering/MediaContractAudit" },
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

async function main() {
  fs.mkdirSync(out, { recursive: true });

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    librarySample,
    status: "PASS" as "PASS" | "WARN",
    items: [] as ReportItem[],
  };

  const res = await fetch(\`\${baseUrl}/api/library/items?page=1&limit=48\`, {
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);

  if (!res || !res.ok) {
    report.status = "WARN";
    report.items.push({
      scope: "library",
      id: "library-api",
      status: "WARN",
      reason: "library_api_unavailable",
      httpStatus: res?.status ?? null,
    });
  } else {
    const body: any = await res.json().catch(() => null);
    const items: Entry[] = Array.isArray(body?.items) ? body.items : [];
    const unique = new Map<string, Entry>();

    for (const item of items) {
      const id = String(item.id ?? item.identifier ?? item.title ?? unique.size);
      if (!unique.has(id)) unique.set(id, item);
    }

    for (const item of [...unique.values()].slice(0, librarySample)) {
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

  const archiveScript = path.join(process.cwd(), "scripts", "check-archive-links.ts");
  const links = fs.existsSync(archiveScript)
    ? fs.readFileSync(archiveScript, "utf8").match(/\/download\/[^'"\`\s)]+/g) ?? []
    : [];

  for (const link of [...new Set(links)]) {
    const url = archiveUrl(link);
    if (!url) continue;

    const checked = await probe(url);
    const pass = checked.ok || checked.status === 206;
    if (!pass) report.status = "WARN";

    report.items.push({
      scope: "archive-hardcoded",
      id: link,
      url,
      status: pass ? "PASS" : "WARN",
      reason: pass ? undefined : "hardcoded_link_unreachable",
      httpStatus: checked.status,
    });
  }

  const output = path.join(out, "media-contract-report.json");
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    status: report.status,
    libraryItems: report.items.filter((x) => x.scope === "library").length,
    hardcodedItems: report.items.filter((x) => x.scope === "archive-hardcoded").length,
    output,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
