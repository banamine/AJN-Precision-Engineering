import assert from "node:assert/strict";
import { classifyKind, reconcile, sortItems, validateBaseline } from "./logic";
import type { RumbleBaseline, RumbleItem } from "./types";
import { registerRumbleRoutes } from "../../server/rumble/routes";

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
  classifyKind(baseItem(), "2026-09-29T12:00:00.000Z", Date.parse("2026-09-30T01:00:00.000Z")),
  "live",
);
assert.equal(
  classifyKind(baseItem(), "2026-09-29T12:00:00.000Z", Date.parse("2026-09-30T13:00:01.000Z")),
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
    thumbnailUrl: "https://example.com/thumb.jpg",
  }),
  baseItem({
    videoId: "unknown-channel",
    channelId: "missing",
    thumbnailUrl: "https://example.com/thumb.jpg",
  }),
]);
assert.equal(validateBaseline(invalid).valid, false);
assert(validateBaseline(invalid).errors.some((error) => error.includes("duplicate videoId")));
assert(validateBaseline(invalid).errors.some((error) => error.includes("unknown channel")));
assert(validateBaseline(invalid).errors.some((error) => error.includes("thumbnailUrl")));

const handlers = new Map<string, Function>();
registerRumbleRoutes({
  get(path: string, handler: Function) {
    handlers.set(path, handler);
  },
} as never);

assert.deepEqual([...handlers.keys()], ["/api/rumble", "/api/rumble/channels", "/api/rumble/items"]);

const responses: Array<{ statusCode: number; body: unknown }> = [];
const makeResponse = () => {
  const response = {
    statusCode: 200,
    status(code: number) {
      response.statusCode = code;
      return response;
    },
    json(body: unknown) {
      responses.push({ statusCode: response.statusCode, body });
      return response;
    },
  };
  return response;
};

const rootResponse = makeResponse();
handlers.get("/api/rumble")({}, rootResponse);
const rootBody = responses.at(-1)?.body as { channels: Array<{ network: string }>; items: RumbleItem[] };
assert.equal(rootBody.channels.length, 3);
assert(rootBody.channels.some((channel) => channel.network === "ajn"));
assert(rootBody.channels.some((channel) => channel.network === "rav"));

const ajnItemsResponse = makeResponse();
handlers.get("/api/rumble/items")({ query: { channelId: "ajn-war-room" } }, ajnItemsResponse);
const ajnItemsBody = responses.at(-1)?.body as { items: RumbleItem[] };
assert(ajnItemsBody.items.every((item) => item.channelId === "ajn-war-room"));
assert(!ajnItemsBody.items.some((item) => item.title.includes("Steve Bannon")));

console.log("[rumble-engine] PASS: classification, ordering, live-to-ended reconciliation, baseline validation, and read-only API.");
