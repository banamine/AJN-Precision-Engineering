import assert from "node:assert/strict";
import fs from "node:fs";
import { NEWS_TARGET_ITEMS, NEWS_WINDOW_HOURS, searchTVNews, TV_ID_RE } from "./channels.ts";
import { calculate48HourUtcWindow, filterArchiveResultsTo48HourWindow } from "./archive-discovery.ts";

assert.equal(NEWS_WINDOW_HOURS, 48);
assert.equal(NEWS_TARGET_ITEMS, 25);
assert.ok(TV_ID_RE.test("FOXNEWSW_20260921_120000_Test_Show"));

const windowEnd = new Date("2026-09-21T15:00:00.000Z");
const window = calculate48HourUtcWindow(windowEnd);
assert.equal(window.start.toISOString(), "2026-09-19T15:00:00.000Z");
assert.equal(window.end.toISOString(), "2026-09-21T15:00:00.000Z");
const boundaryDocs = [
  { identifier: "FOXNEWSW_20260919_150000_Boundary" },
  { identifier: "FOXNEWSW_20260919_145959_Stale" },
  { identifier: "FOXNEWSW_20260921_150001_Future" },
  { identifier: "FOXNEWSW_20260920_120000_Current" },
];
assert.deepEqual(
  filterArchiveResultsTo48HourWindow(boundaryDocs, window).map((doc) => doc.identifier),
  ["FOXNEWSW_20260919_150000_Boundary", "FOXNEWSW_20260920_120000_Current"],
);

const now = Date.now();
function idAt(hoursAgo: number, suffix: string) {
  const d = new Date(now - hoursAgo * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return "FOXNEWSW_" + d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + "_" + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + "_" + suffix;
}
function doc(identifier: string) { return { identifier, title: identifier, publicdate: new Date(now).toISOString() }; }

const pageOne = [
  ...Array.from({ length: 10 }, (_, i) => doc(idAt(i + 1, "Current_" + i))),
  ...Array.from({ length: 40 }, (_, i) => doc("FOXNEWSW_20250901_000000_Stale_" + i)),
];
const pageTwo = [
  ...Array.from({ length: 15 }, (_, i) => doc(idAt(i + 11, "Current_" + (i + 10)))),
  ...Array.from({ length: 5 }, (_, i) => doc("FOXNEWSW_20250101_000000_Old_" + i)),
];

const originalFetch = globalThis.fetch;
let pageCalls = 0;
globalThis.fetch = async (input: string | URL | Request) => {
  const url = String(input);
  if (!url.startsWith("https://archive.org/advancedsearch.php")) throw new Error("Unexpected network call: " + url);
  const start = Number(new URL(url).searchParams.get("start") ?? "0");
  pageCalls++;
  const docs = start === 0 ? pageOne : pageTwo;
  return new Response(JSON.stringify({ response: { numFound: 70, docs } }), { status: 200, headers: { "content-type": "application/json" } });
};

try {
  const result = await searchTVNews({ network: "FOXNEWSW", rows: 25 });
  assert.equal(result.items.length, 25);
  assert.equal(result.freshness.requestedWindowHours, 48);
  assert.equal(result.freshness.returnedCount, 25);
  assert.equal(result.freshness.availableCurrentCount, 25);
  assert.equal(pageCalls, 2);
  assert.ok(result.items.every((item) => /2026/.test(item.date)));
  for (let i = 1; i < result.items.length; i++) {
    const prev = result.items[i - 1];
    const curr = result.items[i];
    assert.ok((prev.date + "T" + prev.time) >= (curr.date + "T" + curr.time));
  }
} finally {
  globalThis.fetch = originalFetch;
}

const server = fs.readFileSync("./server.ts", "utf8");
assert.match(server, /\.\.\.r\.freshness/);
assert.match(fs.readFileSync("./channels.ts", "utf8"), /METADATA_CONCURRENCY = 6/);
console.log("news freshness tests passed");