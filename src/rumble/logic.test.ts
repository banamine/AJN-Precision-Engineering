import assert from "node:assert/strict";
import { classifyKind, reconcile, sortItems, validateBaseline } from "./logic";
import type { RumbleBaseline, RumbleItem } from "./types";

const baseItem = (overrides: Partial<RumbleItem> = {}): RumbleItem => ({
  channelId: "c1",
  videoId: "v1",
  embedId: "v1",
  title: "Live Show",
  thumbnailUrl: null,
  publishedAt: "2026-09-29T12:00:00.000Z",
  durationSec: null,
  kind: "live",
  state: "live",
  ...overrides,
});

const baseline = (items: RumbleItem[]): RumbleBaseline => ({
  version: 1,
  generatedAt: "2026-09-30T00:00:00.000Z",
  channels: [{ id: "c1", network: "ajn", name: "Test", url: "https://rumble.com/c/test" }],
  items,
});

assert.equal(
  classifyKind(baseItem(), Date.parse("2026-09-30T01:00:00.000Z")),
  "live",
);
assert.equal(
  classifyKind(baseItem(), Date.parse("2026-09-30T13:00:01.000Z")),
  "continuous_live",
);

const ordered = sortItems([
  baseItem({ videoId: "vod", title: "VOD", state: "vod", kind: "vod", publishedAt: "2026-09-30T03:00:00.000Z" }),
  baseItem({ videoId: "continuous", title: "Continuous", publishedAt: "2026-09-20T00:00:00.000Z", kind: "continuous_live" }),
  baseItem({ videoId: "live", title: "Live", publishedAt: "2026-09-30T02:00:00.000Z" }),
  baseItem({ videoId: "ended", title: "Ended", state: "ended" }),
]);
assert.deepEqual(ordered.map((item) => item.videoId), ["live", "continuous", "ended", "vod"]);

const prev = baseline([
  baseItem({ videoId: "stream-1", title: "Live Show", kind: "live", state: "live" }),
]);
const next = baseline([
  baseItem({ videoId: "vod-1", title: "Live Show", kind: "vod", state: "vod", publishedAt: "2026-09-30T03:00:00.000Z" }),
]);
const reconciled = reconcile(prev, next);
assert.equal(reconciled.items.find((item) => item.videoId === "stream-1")?.state, "ended");
assert.equal(reconciled.items.find((item) => item.videoId === "vod-1")?.state, "vod");

const invalid = baseline([
  baseItem({
    videoId: "duplicate",
    thumbnailUrl: "http://example.com/thumb.jpg",
  }),
  baseItem({
    videoId: "duplicate",
    channelId: "missing",
    thumbnailUrl: "https://example.com/thumb.jpg",
  }),
]);
assert.equal(validateBaseline(invalid).valid, false);
assert(validateBaseline(invalid).errors.some((error) => error.includes("duplicate videoId")));
assert(validateBaseline(invalid).errors.some((error) => error.includes("unknown channel")));
assert(validateBaseline(invalid).errors.some((error) => error.includes("thumbnailUrl")));

console.log("[rumble-engine] PASS: classification, ordering, live-to-ended reconciliation, and baseline validation.");
