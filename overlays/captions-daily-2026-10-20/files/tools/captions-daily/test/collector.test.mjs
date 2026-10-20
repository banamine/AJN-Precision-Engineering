import test from "node:test";
import assert from "node:assert/strict";
import { collectDay, DAILY_DAY_BUDGET_BYTES, parseBroadcastStartMs, RADIO_ITEMS_PER_DAY, TV_NETWORKS } from "../collector.mjs";
import { parseCsv } from "../csv.mjs";

const TV_ID = "NTD_20261019_120000_SYNTHETIC";
const RADIO_ID = "The_Alex_Jones_Radio_Show_20261019_120000";
const syntheticSrt = [
  "1",
  "00:00:01,000 --> 00:00:02,000",
  "SYNTHETIC CAPTION LINE ONE",
  "",
  "2",
  "00:00:10.000 --> 00:00:11.000",
  "SYNTHETIC CAPTION LINE TWO",
  "",
].join("\r\n");

function fakeRadioStoreFactory({ cacheDir }) {
  assert.equal(cacheDir, null);
  const metadata = {
    identifier: RADIO_ID,
    files: [{ name: `${RADIO_ID}.asr.srt`, private: false }],
  };
  return {
    async buildChannel() {
      return [{ sourceId: RADIO_ID, id: RADIO_ID, metadata: { durationSeconds: 3600 } }];
    },
    cachedItemMetadata(id) { return id === RADIO_ID ? metadata : null; },
    getDiagnostics() { return { candidateCount: 5, resolvedItems: 1, scheduleSeconds: 3600, metadataRequests: 1, skippedCount: 0 }; },
  };
}

function fakeClient({ tvFiles, radioFiles = [{ name: `${RADIO_ID}.asr.srt`, private: false }], huge = false } = {}) {
  const calls = [];
  const client = {
    calls,
    async json(url, { type }) {
      calls.push({ type, url });
      if (type === "tv-search") return {
        ok: true,
        status: 200,
        body: { response: { numFound: 1, docs: [{ identifier: TV_ID }] } },
      };
      if (type === "tv-metadata") return {
        ok: true,
        status: 200,
        body: { metadata: {}, files: tvFiles ?? [] },
      };
      throw new Error("unexpected-json-call");
    },
    async text(url, { type }) {
      calls.push({ type, url });
      const body = huge ? `1\n00:00:01,000 --> 00:00:02,000\n${"SYNTHETIC ".repeat(1200)}\n` : syntheticSrt;
      return { ok: true, status: 200, bytes: Buffer.byteLength(body), body };
    },
  };
  return client;
}

test("UTC parsing and owner configuration are explicit", () => {
  assert.equal(new Date(parseBroadcastStartMs(TV_ID)).toISOString(), "2026-10-19T12:00:00.000Z");
  assert.equal(parseBroadcastStartMs("NTD_20261319_120000_SYNTHETIC"), null);
  assert.equal(RADIO_ITEMS_PER_DAY, 9);
  assert.deepEqual(TV_NETWORKS.map((network) => network.channel), ["CNN", "FOXNEWSW", "MSNOW", "BBCNEWS", "NTD"]);
});

test("invalid calendar dates are rejected before requests", async () => {
  let calls = 0;
  const client = {
    async json() { calls += 1; throw new Error("unexpected request"); },
    async text() { calls += 1; throw new Error("unexpected request"); },
  };
  await assert.rejects(collectDay({ client, dayUtc: "2026-02-31" }), /valid YYYY-MM-DD/);
  assert.equal(calls, 0);
});

test("public TV caption priority and separate radio ASR rows", async () => {
  const client = fakeClient({
    tvFiles: [
      { name: `${TV_ID}.asr.srt`, private: false },
      { name: `${TV_ID}.cc5.srt`, private: false },
      { name: `${TV_ID}.align.srt`, private: false },
    ],
  });
  const result = await collectDay({
    client,
    dayUtc: "2026-10-19",
    networks: [{ channel: "NTD", codes: ["NTD"] }],
    radioLimit: 9,
    radioStoreFactory: fakeRadioStoreFactory,
  });
  assert.equal(result.stats.itemsOk, 2);
  assert.equal(result.stats.rows, 2);
  assert.equal(result.rows[0].caption_kind, "asr");
  assert.equal(result.rows[0].source_kind, "radio");
  assert.equal(result.rows[1].caption_kind, "aligned");
  assert.equal(result.rows[1].source_kind, "tv");
  assert.ok(client.calls.some((call) => call.type === "tv-srt" && call.url.endsWith(".align.srt")));
  const parsed = parseCsv(result.csvBytes);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].machine_generated, "yes");
  assert.equal(parsed[1].machine_generated, "no");
  assert.ok(parsed.every((row) => row.text.startsWith("SYNTHETIC")));
});

test("broadcast cc5 beats ASR, and ASR is the final listed fallback", async () => {
  const noRadio = () => ({
    async buildChannel() { return []; },
    cachedItemMetadata() { return null; },
    getDiagnostics() { return { candidateCount: 0, resolvedItems: 0, scheduleSeconds: 0, metadataRequests: 0, skippedCount: 0 }; },
  });
  for (const [files, expected] of [
    [[{ name: `${TV_ID}.cc5.srt`, private: false }, { name: `${TV_ID}.asr.srt`, private: false }], "broadcast-cc"],
    [[{ name: `${TV_ID}.asr.srt`, private: false }], "asr"],
  ]) {
    const client = fakeClient({ tvFiles: files });
    const result = await collectDay({
      client, dayUtc: "2026-10-19", networks: [{ channel: "NTD", codes: ["NTD"] }],
      radioLimit: 0, radioStoreFactory: noRadio,
    });
    assert.equal(result.stats.itemsOk, 1);
    assert.equal(result.rows[0].caption_kind, expected);
    assert.ok(client.calls.some((call) => call.type === "tv-srt" && call.url.endsWith(`.${expected === "broadcast-cc" ? "cc5" : "asr"}.srt`)));
  }
});

test("private caption files are not requested; explicit skip reason is recorded", async () => {
  const client = fakeClient({
    tvFiles: [{ name: `${TV_ID}.cc5.srt`, private: true }],
    radioFiles: [{ name: `${RADIO_ID}.asr.srt`, private: true }],
  });
  const radioFactory = ({ cacheDir }) => {
    assert.equal(cacheDir, null);
    return {
      async buildChannel() { return [{ sourceId: RADIO_ID, metadata: { durationSeconds: 3600 } }]; },
      cachedItemMetadata() { return { metadata: {}, files: [{ name: `${RADIO_ID}.asr.srt`, private: true }] }; },
      getDiagnostics() { return { candidateCount: 1, resolvedItems: 1, scheduleSeconds: 3600, metadataRequests: 1, skippedCount: 0 }; },
    };
  };
  const result = await collectDay({
    client, dayUtc: "2026-10-19", networks: [{ channel: "NTD", codes: ["NTD"] }],
    radioLimit: 9, radioStoreFactory: radioFactory,
  });
  assert.equal(client.calls.filter((call) => call.type === "tv-srt" || call.type === "radio-asr").length, 0);
  assert.equal(result.stats.rows, 0);
  assert.equal(result.stats.reasonCounts.tv_private_caption_only, 1);
  assert.equal(result.stats.reasonCounts.radio_asr_private, 1);
});

test("day budget skips the oversized whole item without partial rows", async () => {
  const client = fakeClient({ tvFiles: [{ name: `${TV_ID}.align.srt`, private: false }], huge: true });
  const noRadio = (options) => ({
    async buildChannel() { return []; },
    cachedItemMetadata() { return null; },
    getDiagnostics() { return { candidateCount: 0, resolvedItems: 0, scheduleSeconds: 0, metadataRequests: 0, skippedCount: 0 }; },
  });
  const headerBytes = Buffer.byteLength("\uFEFF" + "day_utc,source_kind,channel,genre,program,start_utc,start_s,end_s,caption_kind,machine_generated,item_url,text\r\n");
  const result = await collectDay({
    client, dayUtc: "2026-10-19", networks: [{ channel: "NTD", codes: ["NTD"] }],
    radioLimit: 0, dayBudgetBytes: headerBytes + 64, radioStoreFactory: noRadio,
  });
  assert.equal(result.stats.rows, 0);
  assert.equal(result.stats.itemsOk, 0);
  assert.equal(result.stats.reasonCounts.day_budget, 1);
  assert.ok(result.csvBytes.byteLength <= headerBytes + 64);
  assert.ok(result.csvBytes.byteLength < DAILY_DAY_BUDGET_BYTES);
});

test("the exact application source registry admits four configured news families", async () => {
  const noItemsClient = {
    async json() { return { ok: true, status: 200, body: { response: { numFound: 0, docs: [] } } }; },
    async text() { throw new Error("no caption fetch expected"); },
  };
  const noRadio = () => ({
    async buildChannel() { return []; },
    cachedItemMetadata() { return null; },
    getDiagnostics() { return { candidateCount: 0, resolvedItems: 0, scheduleSeconds: 0, metadataRequests: 0, skippedCount: 0 }; },
  });
  const result = await collectDay({
    client: noItemsClient,
    dayUtc: "2026-10-19",
    networks: TV_NETWORKS.slice(0, 4),
    radioLimit: 0,
    radioStoreFactory: noRadio,
  });
  assert.equal(result.stats.tvSearches, 4);
  assert.equal(result.stats.tvItemsFound, 0);
});
