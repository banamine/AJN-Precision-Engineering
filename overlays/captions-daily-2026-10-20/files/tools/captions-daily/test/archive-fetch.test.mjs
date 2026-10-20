import test from "node:test";
import assert from "node:assert/strict";
import { ArchiveClient, ArchiveStopError } from "../archive-fetch.mjs";

const response = (body = "", status = 200, headers = {}) => new Response(body, { status, headers });

test("429 stops immediately and never retries", async () => {
  let calls = 0;
  const client = new ArchiveClient({
    minGapMs: 0,
    fetchImpl: async () => { calls += 1; return response("", 429); },
  });
  await assert.rejects(client.json("https://archive.org/advancedsearch.php", { type: "search" }), ArchiveStopError);
  await assert.rejects(client.json("https://archive.org/advancedsearch.php", { type: "search" }), ArchiveStopError);
  assert.equal(calls, 1);
  assert.equal(client.summary().physicalStarts, 1);
});

test("Retry-After on a successful response still stops", async () => {
  let calls = 0;
  const client = new ArchiveClient({
    minGapMs: 0,
    fetchImpl: async () => {
      calls += 1;
      return response('{"response":{"docs":[]}}', 200, { "retry-after": "7" });
    },
  });
  await assert.rejects(client.json("https://archive.org/advancedsearch.php", { type: "search" }), /Retry-After/);
  assert.equal(calls, 1);
  assert.equal(client.summary().stopped, "retry-after");
});

test("one isolated 5xx is recorded without retry; next request may proceed", async () => {
  let calls = 0;
  const client = new ArchiveClient({
    minGapMs: 0,
    fetchImpl: async () => {
      calls += 1;
      return calls === 1 ? response("", 503) : response('{"ok":true}');
    },
  });
  const first = await client.json("https://archive.org/metadata/example", { type: "metadata" });
  const second = await client.json("https://archive.org/metadata/example", { type: "metadata" });
  assert.equal(first.status, 503);
  assert.equal(first.ok, false);
  assert.deepEqual(second.body, { ok: true });
  assert.equal(calls, 2);
});

test("two consecutive 5xx responses stop without a third request", async () => {
  let calls = 0;
  const client = new ArchiveClient({
    minGapMs: 0,
    fetchImpl: async () => { calls += 1; return response("", 500); },
  });
  assert.equal((await client.request("https://archive.org/metadata/a", { type: "metadata" })).status, 500);
  await assert.rejects(client.request("https://archive.org/metadata/b", { type: "metadata" }), /Two consecutive/);
  assert.equal(calls, 2);
});

test("each redirect hop is a separate, counted physical start", async () => {
  let calls = 0;
  const client = new ArchiveClient({
    minGapMs: 0,
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? response("", 302, { location: "https://ia800000.us.archive.org/file" })
        : response("synthetic");
    },
  });
  const result = await client.text("https://archive.org/download/example/file.txt", { type: "caption" });
  assert.equal(result.body, "synthetic");
  assert.equal(calls, 2);
  assert.equal(client.summary().physicalStarts, 2);
  assert.equal(client.summary().redirects, 1);
});

test("host validation blocks non-Archive targets before any start", async () => {
  let calls = 0;
  const client = new ArchiveClient({ minGapMs: 0, fetchImpl: async () => { calls += 1; return response(); } });
  await assert.rejects(client.request("https://example.com/", { type: "test" }), /Only HTTPS Archive.org/);
  assert.equal(calls, 0);
  assert.equal(client.summary().physicalStarts, 0);
});

test("the hard job request cap is enforced before another start", async () => {
  let calls = 0;
  const client = new ArchiveClient({
    maxRequests: 1,
    minGapMs: 0,
    fetchImpl: async () => { calls += 1; return response("x"); },
  });
  await client.request("https://archive.org/metadata/a", { type: "metadata" });
  await assert.rejects(client.request("https://archive.org/metadata/b", { type: "metadata" }), /budget reached/);
  assert.equal(calls, 1);
});
