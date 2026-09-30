import assert from "node:assert/strict";
import { classifyKind, reconcile, sortItems, validateBaseline } from "./logic";
import type { RumbleBaseline, RumbleItem } from "./types";
import { RUMBLE_TEST_ITEMS } from "./fixtures";
import { registerRumbleRoutes } from "../../server/rumble/routes";
import { fetchRumbleBaseline } from "./baselineClient";
import { RUMBLE_BASELINE } from "./baseline";
import { rankNewsWall } from "./rank";

const baseItem = (overrides: Partial<RumbleItem> = {}): RumbleItem => ({
  channelId: "c1",
  videoId: "v1",
  embedId: "v1",
  title: "Live Show",
  thumbnailUrl: null,
  publishedAt: "2026-09-29T12:00:00.000Z",
  startedAt: "2026-09-29T12:00:00.000Z",
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
  classifyKind(baseItem(), undefined, Date.parse("2026-09-30T01:00:00.000Z")),
  "live",
);
assert.equal(
  classifyKind(baseItem(), undefined, Date.parse("2026-09-30T13:00:01.000Z")),
  "continuous_live",
);
assert.equal(
  classifyKind(
    { ...baseItem({ startedAt: "2026-09-29T00:00:00.000Z" }), state: "live" },
    undefined,
    Date.parse("2026-09-30T01:00:01.000Z"),
  ),
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
assert.deepEqual(reconciled.items.map((item) => item.videoId), ["vod-1"]);
assert.equal(reconciled.items[0]?.state, "vod");

const endedOnly = reconcile(prev, baseline([]));
assert.equal(endedOnly.items.find((item) => item.videoId === "stream-1")?.state, "ended");

const invalid = baseline([
  baseItem({ videoId: "duplicate", thumbnailUrl: "http://example.com/thumb.jpg" }),
  baseItem({ videoId: "duplicate", thumbnailUrl: "https://example.com/thumb.jpg" }),
  baseItem({ videoId: "unknown-channel", channelId: "missing", thumbnailUrl: "https://example.com/thumb.jpg" }),
]);
assert.equal(validateBaseline(invalid).valid, false);
assert(validateBaseline(invalid).errors.some((error) => error.includes("duplicate videoId")));
assert(validateBaseline(invalid).errors.some((error) => error.includes("unknown channel")));
assert(validateBaseline(invalid).errors.some((error) => error.includes("thumbnailUrl")));

const invalidViewers = baseline([
  baseItem({ videoId: "negative-viewers", viewers: -1 }),
  baseItem({ videoId: "fractional-viewers", viewers: 1.5 }),
]);
const invalidViewerErrors = validateBaseline(invalidViewers).errors;
assert(invalidViewerErrors.some((error) => error.includes("viewers must be a non-negative integer")));

const validZeroViewers = baseline([
  baseItem({ videoId: "zero-viewers", viewers: 0 }),
]);
assert.equal(validateBaseline(validZeroViewers).valid, true);

const invalidRules = baseline([
  baseItem({
    videoId: "bad-network",
    channelId: "c1",
  }),
]);
invalidRules.channels[0].network = "bad" as never;
invalidRules.channels.push({ id: "c1", network: "ajn", name: "Duplicate", url: "https://rumble.com/c/duplicate" });
invalidRules.items[0].publishedAt = "not-a-date";
invalidRules.items[0].startedAt = "not-a-date";
invalidRules.items[0].durationSec = -1;
invalidRules.items[0].state = "vod";
invalidRules.items[0].kind = "live";
const invalidRuleErrors = validateBaseline(invalidRules).errors;
assert(invalidRuleErrors.some((error) => error.includes("network is invalid")));
assert(invalidRuleErrors.some((error) => error.includes("duplicate channel id")));
assert(invalidRuleErrors.some((error) => error.includes("publishedAt")));
assert(invalidRuleErrors.some((error) => error.includes("startedAt")));
assert(invalidRuleErrors.some((error) => error.includes("durationSec")));
assert(invalidRuleErrors.some((error) => error.includes("kind/state mismatch")));

const tooManyChannels = baseline([]) as RumbleBaseline;
tooManyChannels.channels = Array.from({ length: 51 }, (_, index) => ({
  id: `c${index}`,
  network: "ajn",
  name: "Test",
  url: "https://rumble.com/c/test",
}));
assert(validateBaseline(tooManyChannels).errors.some((error) => error.includes("50 channels")));

const tooManyItems = baseline(
  Array.from({ length: 2001 }, (_, index) => baseItem({ videoId: `v${index}` })),
);
assert(validateBaseline(tooManyItems).errors.some((error) => error.includes("2000 items")));

const seedValidation = validateBaseline(RUMBLE_BASELINE);
assert.equal(seedValidation.valid, true);
assert.deepEqual(
  rankNewsWall(RUMBLE_BASELINE).map((item) => item.videoId),
  ["v7g7f18", "v7eh2s2", "v7g6mii", "v7g7f4w"],
);

const rankChannelCapBaseline: RumbleBaseline = {
  version: 1,
  generatedAt: "2026-09-30T00:00:00.000Z",
  channels: [
    { id: "ajn-a", network: "ajn", name: "AJN A", url: "https://rumble.com/c/a" },
    { id: "ajn-b", network: "ajn", name: "AJN B", url: "https://rumble.com/c/b" },
    { id: "ajn-c", network: "ajn", name: "AJN C", url: "https://rumble.com/c/c" },
    { id: "rav-a", network: "rav", name: "RAV A", url: "https://rumble.com/c/ra" },
    { id: "rav-b", network: "rav", name: "RAV B", url: "https://rumble.com/c/rb" },
    { id: "rav-c", network: "rav", name: "RAV C", url: "https://rumble.com/c/rc" },
    { id: "other-a", network: "other", name: "Other A", url: "https://rumble.com/c/oa" },
    { id: "other-b", network: "other", name: "Other B", url: "https://rumble.com/c/ob" },
    { id: "other-c", network: "other", name: "Other C", url: "https://rumble.com/c/oc" },
  ],
  items: [
    baseItem({ channelId: "ajn-a", videoId: "ajn-a-1", viewers: 900 }),
    baseItem({ channelId: "ajn-a", videoId: "ajn-a-2", viewers: 800 }),
    baseItem({ channelId: "ajn-b", videoId: "ajn-b-1", viewers: 700 }),
    baseItem({ channelId: "ajn-c", videoId: "ajn-c-1", viewers: 600 }),
    baseItem({ channelId: "rav-a", videoId: "rav-a-1", viewers: 500 }),
    baseItem({ channelId: "rav-b", videoId: "rav-b-1", viewers: 400 }),
    baseItem({ channelId: "rav-c", videoId: "rav-c-1", viewers: 300 }),
    baseItem({ channelId: "other-a", videoId: "other-a-1", viewers: 200 }),
    baseItem({ channelId: "other-b", videoId: "other-b-1", viewers: 100 }),
    baseItem({ channelId: "other-c", videoId: "other-c-1", viewers: 50 }),
  ],
};
const rankedCaps = rankNewsWall(rankChannelCapBaseline, { max: 10 });
assert.deepEqual(
  rankedCaps.map((item) => item.videoId),
  ["ajn-a-1", "ajn-b-1", "rav-a-1", "rav-b-1", "other-a-1", "other-b-1", "other-c-1"],
);
assert.equal(rankedCaps.filter((item) => item.channelId === "ajn-a").length, 1);
assert.equal(rankedCaps.filter((item) => item.channelId.startsWith("ajn-")).length, 2);
assert.equal(rankedCaps.filter((item) => item.channelId.startsWith("rav-")).length, 2);
assert.equal(rankedCaps.filter((item) => item.channelId.startsWith("other-")).length, 3);

const tieBaseline = baseline([
  baseItem({ videoId: "tie-old", viewers: 100, startedAt: "2026-09-30T01:00:00.000Z" }),
  baseItem({ videoId: "tie-new", viewers: 100, startedAt: "2026-09-30T02:00:00.000Z", channelId: "c2" }),
]);
tieBaseline.channels.push({ id: "c2", network: "other", name: "C2", url: "https://rumble.com/c/c2" });
assert.equal(rankNewsWall(tieBaseline, { max: 2 })[0]?.videoId, "tie-new");

const noLiveBaseline = baseline([
  baseItem({ videoId: "vod-only", viewers: 999, state: "vod", kind: "vod" }),
  baseItem({ videoId: "ended-only", viewers: 998, state: "ended", kind: "live" }),
]);
assert.deepEqual(rankNewsWall(noLiveBaseline), []);

const emptyBaseline: RumbleBaseline = {
  version: 1,
  generatedAt: "2026-09-30T00:00:00.000Z",
  channels: [],
  items: [],
};
assert.deepEqual(rankNewsWall(emptyBaseline), []);

const handlers = new Map<string, Function>();
registerRumbleRoutes({
  get(path: string, handler: Function) {
    handlers.set(path, handler);
  },
} as never);

assert.deepEqual([...handlers.keys()], [
  "/api/rumble",
  "/api/rumble/baseline",
  "/api/rumble/channels",
  "/api/rumble/items",
]);

const invoke = (path: string, query = {}, env?: string, injected: RumbleBaseline = {
  version: 1,
  generatedAt: "2026-09-30T00:00:00.000Z",
  channels: [
    { id: "ajn-alex-jones-show", network: "ajn", name: "Alex Jones Show", url: "https://rumble.com/c/alex" },
    { id: "ajn-war-room", network: "ajn", name: "War Room with Harrison Smith", url: "https://rumble.com/c/war-room" },
    { id: "rav-real-americas-voice", network: "rav", name: "Real America's Voice", url: "https://rumble.com/c/rav" },
  ],
  items: RUMBLE_TEST_ITEMS,
}) => {
  const handlerMap = new Map<string, Function>();
  registerRumbleRoutes({
    get(route: string, handler: Function) {
      handlerMap.set(route, handler);
    },
  } as never, injected);
  const oldEnv = process.env.RUMBLE_ENGINE_ENABLED;
  if (env === undefined) delete process.env.RUMBLE_ENGINE_ENABLED;
  else process.env.RUMBLE_ENGINE_ENABLED = env;
  const responses: Array<{ statusCode: number; body: unknown }> = [];
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
  handlerMap.get(path)?.({ query }, response);
  if (oldEnv === undefined) delete process.env.RUMBLE_ENGINE_ENABLED;
  else process.env.RUMBLE_ENGINE_ENABLED = oldEnv;
  return responses.at(-1);
};

const root = invoke("/api/rumble");
assert.equal(root?.statusCode, 200);
const rootBody = root?.body as { ok: boolean; items: RumbleItem[] };
assert.equal(rootBody.ok, true);
assert(rootBody.items.length > 0);

const ajnItems = invoke("/api/rumble/items", { channelId: "ajn-war-room" }, undefined, RUMBLE_BASELINE);
assert.equal(ajnItems?.statusCode, 200);
const ajnItemsBody = ajnItems?.body as { items: RumbleItem[] };
assert.equal(ajnItemsBody.items.length, 0);

const baselineSeedResponse = invoke("/api/rumble/baseline", {}, undefined, RUMBLE_BASELINE);
assert.equal(baselineSeedResponse?.statusCode, 200);
const baselineSeedBody = baselineSeedResponse?.body as { ok: boolean; items: RumbleItem[] };
assert.equal(baselineSeedBody.ok, true);
assert.equal(baselineSeedBody.items.length, 16);

const ravBannonItems = invoke("/api/rumble/items", { channelId: "rav-bannons-war-room" }, undefined, RUMBLE_BASELINE);
assert.equal(ravBannonItems?.statusCode, 200);
const ravBannonBody = ravBannonItems?.body as { items: RumbleItem[] };
assert.equal(ravBannonBody.items.length, 1);
assert.equal(ravBannonBody.items[0]?.videoId, "v7g70xi");

const baselineResponse = invoke("/api/rumble/baseline", {}, undefined, RUMBLE_BASELINE);
assert.equal(baselineResponse?.statusCode, 200);
assert.equal((baselineResponse?.body as { ok: boolean }).ok, true);
assert.equal((baselineResponse?.body as { items: RumbleItem[] }).items.length, 16);

for (const path of ["/api/rumble", "/api/rumble/baseline", "/api/rumble/channels", "/api/rumble/items"]) {
  const disabled = invoke(path, {}, "false");
  assert.equal(disabled?.statusCode, 200);
  assert.deepEqual(disabled?.body, { ok: false, reason: "disabled" });
}

const invalidBaseline = baseline(RUMBLE_TEST_ITEMS);
invalidBaseline.channels[0].url = "http://invalid.example";
for (const path of ["/api/rumble", "/api/rumble/baseline", "/api/rumble/channels", "/api/rumble/items"]) {
  const invalidResponse = invoke(path, {}, "true", invalidBaseline);
  assert.equal(invalidResponse?.statusCode, 200);
  assert.deepEqual(invalidResponse?.body, { ok: false, reason: "invalid-baseline" });
}

const testStorage = new Map<string, string>();
const storage = {
  getItem: (key: string) => testStorage.get(key) ?? null,
  setItem: (key: string, value: string) => { testStorage.set(key, value); },
};
const fakeFetch = async () => new Response(JSON.stringify({
  version: 7,
  generatedAt: "2026-09-30T00:00:00.000Z",
  channels: [],
  items: [],
}), { status: 200, headers: { "content-type": "application/json" } });
const firstClient = await fetchRumbleBaseline(1000, fakeFetch, storage);
assert.equal(firstClient.changed, true);
assert.equal(firstClient.baseline?.version, 7);
const secondClient = await fetchRumbleBaseline(1000, fakeFetch, storage);
assert.equal(secondClient.changed, false);

const blockedStorage = {
  getItem: () => { throw new Error("blocked"); },
  setItem: () => { throw new Error("blocked"); },
};
const blockedClient = await fetchRumbleBaseline(1000, fakeFetch, blockedStorage);
assert.equal(blockedClient.changed, true);
assert.equal(blockedClient.baseline?.version, 7);

const timeoutFetch = async (_url: string, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  });
const timeoutClient = await fetchRumbleBaseline(1, timeoutFetch as typeof fetch);
assert.equal(timeoutClient.baseline, null);

console.log("[rumble-engine] PASS: fixture classification, ordering, reconciliation, validation, seed, news-wall ranking, injected routes, disabled/invalid route behavior, and baseline client.");
