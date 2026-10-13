import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import "../youtube/youtube.test";
import "../showinfo/showinfo.test";
import "../guide/scheduleCache.test";
import "../nav/lastView.test";
import "./importer.test";
import "./pastedVideo.test";
import type { NewsProvider, ParsedNewsInput, ResolvedMedia } from "./contract";
import { parseNewsInput } from "./registry";
import { parseRumblePageUrl, rumblePageUrlForVideoId, rumbleProvider } from "./providers/rumble";
import { clearNewsResolveCache, resolveNewsLink } from "../../server/news/resolve";
import { registerNewsRoutes } from "../../server/news/routes";
import { resolveNewsOnServer } from "./client";
import { channelsWithoutVideo, lastKnownItem, listChannelPicks, pageUrlForItem, snapshotAgeHours } from "../rumble/wall";
import { RUMBLE_BASELINE } from "../rumble/baseline";
import type { RumbleBaseline, RumbleItem } from "../rumble/types";
import { applyPastedVideo } from "./pastedVideo";
import { chooseBaseline, loadOverride, saveOverride, OVERRIDE_KEY } from "./override";
import {
  buildNewsWall, clearWallPicks, duplicateWallChannelNotes, loadWallPicks,
  MAX_WALL_PICK_CHARS, restoreWallSlots, saveWallPicks, toSource, WALL_PICKS_KEY,
  type WallPicks, type WallPickStorage, type WallSource,
} from "../rumble/wall";
import { rankNewsWall } from "../rumble/rank";
import { commitResolvedRumblePaste, RumbleNewsWall, RumbleWallStatus } from "../components/RumbleNewsWall";

// ---- Rumble parsing (guards) ----
const good = "https://rumble.com/v7gdv2i-the-horrifying-truth-about-lethal-injection.html?e9s=src_v1_cbl%2Csrc_v1_ucp_a";
assert.deepEqual(parseRumblePageUrl(good), {
  id: "v7gdv2i",
  pageUrl: "https://rumble.com/v7gdv2i-the-horrifying-truth-about-lethal-injection.html",
});
assert.equal(parseRumblePageUrl("https://www.rumble.com/v7g7f18-how-the-cia-started-disney.html")?.id, "v7g7f18");
for (const bad of [
  "http://rumble.com/v7gdv2i-x.html",
  "https://evil.com/v7gdv2i-x.html",
  "https://rumble.com.evil.com/v7gdv2i-x.html",
  "https://user:pw@rumble.com/v7gdv2i-x.html",
  "https://rumble.com:8443/v7gdv2i-x.html",
  "https://rumble.com/c/Redacted",
  "https://rumble.com/v7gdv2i.html",
  "https://rumble.com/../v7gdv2i-x.html/extra",
  "https://rumble.com/v7gdv2i-x.html/extra",
  "javascript:alert(1)",
  "not a url",
  "",
]) {
  assert.equal(parseRumblePageUrl(bad), null, `should reject: ${bad}`);
  assert.equal(parseNewsInput(bad)?.kind === "page", false, `parseNewsInput must not treat as page: ${bad}`);
}

// ---- parseNewsInput kinds ----
assert.deepEqual(parseNewsInput("v7e7i50"), { provider: "rumble", kind: "id", id: "v7e7i50" });
assert.deepEqual(parseNewsInput("https://rumble.com/embed/v7e7i50/?pub=4"), { provider: "rumble", kind: "embed", id: "v7e7i50" });
assert.equal(parseNewsInput(good)?.kind, "page");
assert.equal(parseNewsInput("   "), null);
assert.equal(rumblePageUrlForVideoId("V7GDV2I"), "https://rumble.com/v7gdv2i-video.html");
assert.equal(parseRumblePageUrl(rumblePageUrlForVideoId("v7gdv2i"))?.id, "v7gdv2i");
assert.equal(rumbleProvider.extractEmbedId('<iframe src="https://rumble.com/embed/v7e7i50/" width="1"></iframe>'), "v7e7i50");
assert.equal(rumbleProvider.extractEmbedId("<p>nothing</p>"), null);

// ---- resolver (server) with fake fetch; shape copied from the real 2026-10-06 oEmbed answer ----
const oembedBody = {
  type: "video",
  title: "The Horrifying Truth About Lethal Injection",
  author_name: "Redacted News",
  author_url: "https://rumble.com/c/Redacted",
  html: '<iframe src="https://rumble.com/embed/v7e7i50/" width="3840" height="2160" frameborder="0"></iframe>',
  duration: 2335,
  thumbnail_url: "https://hugh.cdn.rumble.cloud/video/fww1/67/s8/1/k/Q/M/3/kQM3A.qR4e-small-x.jpg",
};
const calls: Array<{ url: string; init?: RequestInit }> = [];
const okFetch = (async (url: string, init?: RequestInit) => {
  calls.push({ url: String(url), init });
  return new Response(JSON.stringify(oembedBody), { status: 200 });
}) as unknown as typeof fetch;

clearNewsResolveCache();
const first = await resolveNewsLink(good, okFetch);
assert.equal(first.ok, true);
if ("media" in first) {
  assert.equal(first.media.embedId, "v7e7i50");
  assert.equal(first.media.embedSrc, "https://rumble.com/embed/v7e7i50/?pub=4");
  assert.equal(first.media.author, "Redacted News");
  assert.equal(first.media.authorUrl, "https://rumble.com/c/Redacted");
  assert.equal(first.media.durationSec, 2335);
}
assert.equal(calls.length, 1);
assert.ok(calls[0].url.startsWith("https://rumble.com/api/Media/oembed.json?url="), "fixed provider host only");
assert.ok(!calls[0].url.includes("e9s="), "tracking query is stripped");
assert.equal(calls[0].init?.redirect, "error");
await resolveNewsLink(good, okFetch);
assert.equal(calls.length, 1, "success is cached");

for (const authorUrl of [
  "https://example.com/c/Redacted",
  "http://rumble.com/c/Redacted",
  "https://user:pw@rumble.com/c/Redacted",
  "https://rumble.com:8443/c/Redacted",
  "https://rumble.com/c/",
]) {
  clearNewsResolveCache();
  const authorFetch = (async () => new Response(JSON.stringify({ ...oembedBody, author_url: authorUrl }), { status: 200 })) as unknown as typeof fetch;
  const authorResult = await resolveNewsLink(good, authorFetch);
  assert.equal(authorResult.ok, true);
  if ("media" in authorResult) assert.equal(authorResult.media.authorUrl, null, authorUrl);
}

clearNewsResolveCache();
calls.length = 0;
const viaEmbed = await resolveNewsLink("v7e7i50", okFetch);
assert.equal(viaEmbed.ok, true);
assert.ok(decodeURIComponent(calls[0].url).includes("https://rumble.com/embed/v7e7i50/"));

calls.length = 0;
const invalid = await resolveNewsLink("https://evil.com/x", okFetch);
assert.deepEqual(invalid, { ok: false, reason: "invalid-input" });
assert.equal(calls.length, 0, "invalid input never reaches the network");

const status = (code: number, body = "") => (async () => new Response(body, { status: code })) as unknown as typeof fetch;
clearNewsResolveCache();
assert.equal((await resolveNewsLink(good, status(404, "Media not found with that url")) as { reason: string }).reason, "not-found");
assert.equal((await resolveNewsLink(good, status(403, "Just a moment...")) as { reason: string }).reason, "upstream-error");
assert.equal((await resolveNewsLink(good, status(200, "<html>")) as { reason: string }).reason, "bad-response");
assert.equal((await resolveNewsLink(good, status(200, JSON.stringify({ title: "x", html: "<p>no embed</p>" }))) as { reason: string }).reason, "bad-response");
assert.equal((await resolveNewsLink(good, status(200, "x".repeat(70_000))) as { reason: string }).reason, "bad-response");
const hang = (async (_u: string, init?: RequestInit) =>
  new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("Aborted", "AbortError"))))) as unknown as typeof fetch;
assert.equal((await resolveNewsLink(good, hang, 5) as { reason: string }).reason, "timeout");
const boom = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
assert.equal((await resolveNewsLink(good, boom) as { reason: string }).reason, "upstream-error");
// failures are never cached: a later success must go through
assert.equal((await resolveNewsLink(good, okFetch)).ok, true);

// ---- contract is provider-agnostic: a YouTube stub plugs in without touching the resolver ----
const youtubeStub: NewsProvider = {
  id: "youtube",
  parseInput(text: string): ParsedNewsInput | null {
    const m = String(text).match(/^https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})$/);
    return m ? { provider: "youtube", kind: "page", id: m[1], pageUrl: text } : null;
  },
  embedSrc: (id) => `https://www.youtube.com/embed/${id}`,
  lookupUrlForEmbed: (id) => `https://www.youtube.com/watch?v=${id}`,
  oembedUrl: (u) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u)}`,
  extractEmbedId: (html) => html.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{11})/)?.[1] ?? null,
};
const ytFetch = (async (url: string) => {
  assert.ok(String(url).startsWith("https://www.youtube.com/oembed"));
  return new Response(JSON.stringify({ title: "Never Gonna Give You Up", author_name: "Rick Astley", html: '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ?feature=oembed"></iframe>' }), { status: 200 });
}) as unknown as typeof fetch;
clearNewsResolveCache();
const yt = await resolveNewsLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ", ytFetch, 5000, Date.now, [rumbleProvider, youtubeStub]);
assert.equal(yt.ok, true);
if ("media" in yt) {
  assert.equal(yt.media.provider, "youtube");
  assert.equal(yt.media.embedSrc, "https://www.youtube.com/embed/dQw4w9WgXcQ");
}

// ---- client ----
const clientOk = (async () => new Response(JSON.stringify({ ok: true, media: first.ok ? (first as { media: unknown }).media : null }), { status: 200 })) as unknown as typeof fetch;
assert.equal((await resolveNewsOnServer(good, 1000, clientOk)).ok, true);
const clientBad = (async () => new Response(JSON.stringify({ ok: true, media: { embedId: 1 } }), { status: 200 })) as unknown as typeof fetch;
assert.equal(((await resolveNewsOnServer(good, 1000, clientBad)) as { reason: string }).reason, "bad-response");
const clientFail = (async () => new Response(JSON.stringify({ ok: false, reason: "not-found" }), { status: 200 })) as unknown as typeof fetch;
assert.equal(((await resolveNewsOnServer(good, 1000, clientFail)) as { reason: string }).reason, "not-found");
const clientHang = (async (_u: string, init?: RequestInit) =>
  new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("Aborted", "AbortError"))))) as unknown as typeof fetch;
assert.equal(((await resolveNewsOnServer(good, 1, clientHang)) as { reason: string }).reason, "timeout");

// ---- route (always HTTP 200, explicit reasons) ----
type Handler = (req: { query: Record<string, unknown>; ip?: string }, res: { status: (n: number) => { json: (b: unknown) => unknown } }) => Promise<unknown>;
let handler: Handler | null = null;
registerNewsRoutes({ get: (_path: string, h: Handler) => { handler = h; } } as never);
assert.ok(handler);
const run = async (query: Record<string, unknown>, ip = "1.1.1.1") => {
  let sent: { code: number; body: unknown } | null = null;
  await handler!({ query, ip }, { status: (code) => ({ json: (body) => { sent = { code, body }; return body; } }) });
  return sent as unknown as { code: number; body: { ok: boolean; reason?: string } };
};
assert.deepEqual(await run({}), { code: 200, body: { ok: false, reason: "invalid-input" } });
assert.deepEqual(await run({ url: "x".repeat(601) }), { code: 200, body: { ok: false, reason: "invalid-input" } });
assert.deepEqual(await run({ url: "https://evil.com/x" }, "2.2.2.2"), { code: 200, body: { ok: false, reason: "invalid-input" } });
let last = { code: 0, body: { ok: true } as { ok: boolean; reason?: string } };
for (let i = 0; i < 62; i += 1) last = await run({ url: "https://evil.com/x" }, "9.9.9.9");
assert.equal(last.body.reason, "rate-limited");
process.env.RUMBLE_ENGINE_ENABLED = "false";
assert.deepEqual(await run({ url: good }, "3.3.3.3"), { code: 200, body: { ok: false, reason: "disabled" } });
delete process.env.RUMBLE_ENGINE_ENABLED;

// ---- channel picks (last known link) ----
const item = (o: Partial<RumbleItem>): RumbleItem => ({
  channelId: "c1", videoId: "v1aaaa", embedId: "v1bbbb", title: "t", thumbnailUrl: null,
  publishedAt: null, durationSec: null, kind: "vod", state: "vod", ...o,
});
const base = (items: RumbleItem[]): RumbleBaseline => ({
  version: 1, generatedAt: "2026-09-30T20:47:09.000Z",
  channels: [
    { id: "c1", network: "other", name: "Zed", url: "https://rumble.com/c/z" },
    { id: "c2", network: "ajn", name: "Alpha", url: "https://rumble.com/c/a" },
    { id: "c3", network: "rav", name: "Empty", url: "https://rumble.com/c/e" },
  ],
  items,
});
const live = item({ videoId: "v1live1", embedId: "v1live2", state: "live", kind: "live", viewers: 10, startedAt: "2026-09-30T10:00:00.000Z" });
const newer = item({ videoId: "v1new11", embedId: "v1new22", publishedAt: "2026-09-29T00:00:00.000Z" });
const older = item({ videoId: "v1old11", embedId: "v1old22", publishedAt: "2026-09-01T00:00:00.000Z" });
const undated = item({ videoId: "v1und11", embedId: "v1und22", publishedAt: null });
assert.equal(lastKnownItem(base([older, newer, live]), "c1")?.videoId, "v1live1", "live beats any VOD");
assert.equal(lastKnownItem(base([older, newer]), "c1")?.videoId, "v1new11", "newest dated VOD");
assert.equal(lastKnownItem(base([undated, older]), "c1")?.videoId, "v1old11", "undated never beats dated");
assert.equal(lastKnownItem(base([]), "c1"), null);
const picks = listChannelPicks(base([newer, item({ channelId: "c2", videoId: "v2aaaa", embedId: "v2bbbb", state: "live", kind: "live" })]));
assert.deepEqual(picks.map((p) => p.channelId), ["c2", "c1"], "AJN network first, channels without items omitted");
assert.equal(picks[1].pageUrl, "https://rumble.com/v1new11-video.html");
assert.equal(parseNewsInput(picks[1].pageUrl)?.kind, "page", "a pick's link is a pasteable page URL");
assert.equal(pageUrlForItem(item({ pageUrl: "https://rumble.com/v9zzzz-real-slug.html", videoId: "v9zzzz" })), "https://rumble.com/v9zzzz-real-slug.html");
assert.equal(pageUrlForItem(item({ pageUrl: "https://evil.com/v9zzzz-x.html", videoId: "v9zzzz" })), "https://rumble.com/v9zzzz-video.html");
assert.deepEqual(channelsWithoutVideo(base([newer])).map((c) => c.id), ["c2", "c3"]);
assert.equal(snapshotAgeHours(base([]), Date.parse("2026-10-06T20:47:09.000Z")), 144);
assert.equal(snapshotAgeHours({ ...base([]), generatedAt: "bad" }), null);

// Real baseline: every channel with an item yields a pasteable link; four channels have none yet.
const realPicks = listChannelPicks(RUMBLE_BASELINE);
assert.ok(realPicks.length >= 10);
for (const pick of realPicks) assert.equal(parseNewsInput(pick.pageUrl)?.kind, "page", pick.channelId);
assert.equal(channelsWithoutVideo(RUMBLE_BASELINE).length, RUMBLE_BASELINE.channels.length - realPicks.length);

// ---- Phase 2B: injected-clock, storage, selection and real component markup ----
{
  const clock = () => new Date("2026-10-08T15:30:00.000Z");
  const stamp = clock().toISOString();
  const page = "https://rumble.com/v1aaaa-recorded.html";
  const fixture: RumbleBaseline = {
    version: 7,
    generatedAt: "2026-10-06T12:00:00.000Z",
    channels: [
      { id: "news-rt", network: "other", name: "RT News 24/7", url: "https://rumble.com/c/RT" },
      { id: "c1", network: "other", name: "Recorded channel", url: "https://rumble.com/c/Recorded" },
      { id: "c2", network: "other", name: "Stale live channel", url: "https://rumble.com/c/Stale" },
      // Deliberately identical display names: identity must never come from the name.
      { id: "ajn-war-room", network: "ajn", name: "War Room", url: "https://rumble.com/c/WarRoomRumble" },
      { id: "rav-bannons-war-room", network: "rav", name: "War Room", url: "https://rumble.com/c/BannonsWarRoom" },
    ],
    items: [
      item({ channelId: "news-rt", videoId: "v1rt11", embedId: "v1rt22", kind: "continuous_live", state: "live", viewers: 1 }),
      item({ channelId: "c1", videoId: "v1aaaa", embedId: "v1bbbb", title: "Recorded episode", seenAt: "2026-10-06T10:00:00.000Z", pageUrl: page }),
      item({ channelId: "c2", videoId: "v1cccc", embedId: "v1dddd", kind: "live", state: "live", viewers: 99999 }),
      item({ channelId: "ajn-war-room", videoId: "v1war1", embedId: "v1war2", kind: "live", state: "live", viewers: 20 }),
      item({ channelId: "rav-bannons-war-room", videoId: "v1rav1", embedId: "v1rav2", kind: "live", state: "live", viewers: 10 }),
    ],
  };
  const media: ResolvedMedia = {
    provider: "rumble", embedId: "v1bbbb", embedSrc: "https://rumble.com/embed/v1bbbb/?pub=4",
    title: "Recorded episode", author: "Recorded channel", authorUrl: "https://rumble.com/c/Recorded",
    thumbnailUrl: null, durationSec: 1200, resolvedAt: "2026-10-08T14:00:00.000Z",
  };
  const makeStorage = () => {
    const values = new Map<string, string>();
    const writes: string[] = [];
    const removals: string[] = [];
    const storage: WallPickStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { writes.push(key); values.set(key, value); },
      removeItem: (key) => { removals.push(key); values.delete(key); },
    };
    return { values, writes, removals, storage };
  };
  const original = JSON.stringify(fixture);
  const unchanged = applyPastedVideo(fixture, media, page, clock());
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.channelId, "c1");
  assert.equal(unchanged.baseline, fixture, "same stored embed returns the original baseline");
  assert.equal(unchanged.baseline.version, 7);
  assert.equal(unchanged.baseline.generatedAt, fixture.generatedAt);
  assert.equal(unchanged.baseline.items[1].seenAt, "2026-10-06T10:00:00.000Z");
  assert.equal(JSON.stringify(fixture), original, "no source metadata changes");
  const alias = applyPastedVideo(fixture, { ...media, title: "Different display metadata", durationSec: 99 },
    "https://rumble.com/v9aaaa-alias.html", clock());
  assert.equal(alias.baseline, fixture, "same EMBED id is a no-op even with a different page id/title");
  assert.equal(JSON.stringify(alias.baseline), original, "canonical URL, page id and metadata remain intact");

  const memory = makeStorage();
  let baselineWrites = 0;
  let selectedSource: WallSource | null = null;
  let savedPicks: WallPicks = [null, null, null, null];
  const saveBaseline = (next: RumbleBaseline) => {
    baselineWrites += 1;
    return saveOverride(next, memory.storage);
  };
  const loadSelectedPanel = (source: WallSource) => {
    selectedSource = source;
    savedPicks = savedPicks.map((pick, index) => index === 2 ? source : pick);
    return saveWallPicks(savedPicks, memory.storage).ok;
  };
  const paste = (current: WallSource, active = true) => commitResolvedRumblePaste({
    baseline: fixture, current, active, media, pageUrl: page, pastedAt: clock(),
    onApplyBaseline: saveBaseline, onChange: loadSelectedPanel,
  });
  const alreadyMessage = paste(toSource(fixture.items[1], fixture));
  assert.equal(alreadyMessage, "Already showing this video");
  assert.equal(baselineWrites, 0);
  assert.equal(selectedSource, null, "already showing does not replace the panel");
  assert.equal(memory.writes.length, 0, "already stored AND showing performs zero storage writes");

  const loadedMessage = paste(toSource(fixture.items[2], fixture));
  assert.equal(loadedMessage, "Loaded: Recorded episode (already saved as this channel's latest)");
  assert.equal(baselineWrites, 0, "loading an already-stored embed never writes the baseline");
  assert.deepEqual(memory.writes, [WALL_PICKS_KEY], "only the selected panel pick is saved");
  assert.equal(savedPicks[2]?.embedId, media.embedId);
  assert.equal(savedPicks[2]?.pastedAt, stamp, "paste time comes from the injected clock, not resolvedAt");
  assert.equal(JSON.stringify(fixture), original);
  const stoppedMessage = paste(toSource(fixture.items[1], fixture), false);
  assert.equal(stoppedMessage, loadedMessage, "Go loads an inactive panel even if its embed already matches");

  const reloaded = loadWallPicks(memory.storage);
  assert.equal(reloaded.error, null);
  const restored = restoreWallSlots(fixture, reloaded.picks, clock().getTime());
  assert.equal(restored[2].channelId, "c1");
  assert.equal(restored[2].embedId, media.embedId);
  assert.equal(restored[2].pastedAt, stamp);
  assert.equal(restored[0].channelId, "news-rt", "RT retains the first default live slot");
  assert.equal(new Set(restored.map((source) => source.channelId)).size, restored.length);

  const server: RumbleBaseline = {
    ...fixture, version: 99, generatedAt: "2026-10-09T12:00:00.000Z",
    items: fixture.items.map((entry) => entry.channelId === "c1" ? { ...entry, embedId: "v2bbbb" } : entry),
  };
  const writesBeforeRefresh = memory.writes.length;
  const chosen = chooseBaseline([fixture, server, loadOverride(memory.storage)]);
  assert.equal(chosen, server);
  const afterServer = restoreWallSlots(chosen, reloaded.picks, clock().getTime());
  assert.deepEqual(afterServer[2], restored[2], "server response cannot replace the saved slot or its label/time");
  assert.equal(memory.writes.length, writesBeforeRefresh, "restoration and server reconciliation do not write storage");
  const changedPanelPicks = reloaded.picks.map((pick, index) => index === 2 ? toSource(fixture.items[2], fixture) : pick);
  const changedPanelSlots = restoreWallSlots(server, changedPanelPicks, clock().getTime());
  assert.equal(changedPanelSlots[2].channelId, "c2", "explicitly changing that panel replaces its saved preference");
  assert.equal(changedPanelSlots[2].pastedAt, undefined, "a channel selection does not inherit another video's paste label");

  const ranked = buildNewsWall(fixture, 4, { pastedSources: [restored[2]], nowMs: clock().getTime() });
  assert.equal(ranked[0].channelId, "news-rt");
  assert.equal(ranked[1].channelId, "c1", "explicit pasted VOD beats the stale high-viewer live item");
  assert.ok(ranked.findIndex((entry) => entry.channelId === "c1") < ranked.findIndex((entry) => entry.channelId === "c2"));
  assert.ok(rankNewsWall(fixture).every((entry) => entry.state === "live"), "generic rank remains live-only");
  const withoutRtLive = { ...fixture, items: fixture.items.map((entry) => entry.channelId === "news-rt" ? { ...entry, state: "vod" as const } : entry) };
  assert.ok(!buildNewsWall(withoutRtLive).some((entry) => entry.channelId === "news-rt"), "RT is still pinned only when marked live");
  const duplicateLive = { ...fixture, items: [...fixture.items, item({ channelId: "c2", videoId: "v2cccc", embedId: "v2dddd", kind: "live", state: "live", viewers: 4 })] };
  const defaultPicks = buildNewsWall(duplicateLive);
  assert.equal(new Set(defaultPicks.map((entry) => entry.channelId)).size, defaultPicks.length);

  const duplicateMemory = makeStorage();
  assert.equal(saveWallPicks([restored[2], null, restored[2], null], duplicateMemory.storage).ok, true, "manual duplicates can be saved");
  assert.deepEqual(duplicateWallChannelNotes([restored[2], restored[2]]), ["Recorded channel is in two panels"]);
  const deduped = loadWallPicks(duplicateMemory.storage).picks;
  assert.equal(deduped[0]?.channelId, "c1");
  assert.equal(deduped[2], null, "restoration drops later duplicate channel IDs");
  const uniqueRestored = restoreWallSlots(fixture, deduped, clock().getTime());
  assert.equal(new Set(uniqueRestored.map((source) => source.channelId)).size, uniqueRestored.length);

  const ajnPaste = applyPastedVideo(fixture, { ...media, embedId: "v2war2", authorUrl: "https://rumble.com/c/WarRoomRumble" }, "https://rumble.com/v2war1-show.html", clock());
  assert.equal(ajnPaste.channelId, "ajn-war-room");
  assert.deepEqual(ajnPaste.baseline.items.filter((entry) => entry.channelId === "rav-bannons-war-room"),
    fixture.items.filter((entry) => entry.channelId === "rav-bannons-war-room").map((entry) => ({ ...entry, seenAt: fixture.generatedAt })));
  const ravPaste = applyPastedVideo(ajnPaste.baseline, { ...media, embedId: "v2rav2", authorUrl: "https://rumble.com/c/BannonsWarRoom" }, "https://rumble.com/v2rav1-show.html", clock());
  assert.equal(ravPaste.channelId, "rav-bannons-war-room");
  const rooms: WallPicks = [
    { ...toSource(ravPaste.baseline.items.find((entry) => entry.channelId === "ajn-war-room")!, ravPaste.baseline), pastedAt: stamp },
    { ...toSource(ravPaste.baseline.items.find((entry) => entry.channelId === "rav-bannons-war-room")!, ravPaste.baseline), pastedAt: stamp },
    null, null,
  ];
  const roomMemory = makeStorage();
  assert.equal(saveWallPicks(rooms, roomMemory.storage).ok, true);
  const restoredRooms = restoreWallSlots(ravPaste.baseline, loadWallPicks(roomMemory.storage).picks, clock().getTime());
  assert.equal(restoredRooms[0].channelId, "ajn-war-room");
  assert.equal(restoredRooms[1].channelId, "rav-bannons-war-room");
  assert.deepEqual(duplicateWallChannelNotes(restoredRooms), [], "identical display names never merge the War Rooms");

  const changedMedia = { ...media, embedId: "v2bbbb" };
  const changed = applyPastedVideo(fixture, changedMedia, "https://rumble.com/v2aaaa-new.html", clock());
  assert.equal(changed.changed, true);
  assert.equal(changed.baseline.version, 8);
  assert.equal(changed.baseline.generatedAt, stamp);
  assert.equal(changed.baseline.items.find((entry) => entry.channelId === "c1")?.seenAt, stamp);
  assert.equal(JSON.stringify(fixture), original, "new paste does not mutate its input");
  let changedBaseline: RumbleBaseline | null = null;
  const changedStorage = makeStorage();
  const freshStatus = commitResolvedRumblePaste({
    baseline: fixture, current: toSource(fixture.items[2], fixture), active: true,
    media: changedMedia, pageUrl: "https://rumble.com/v2aaaa-new.html", pastedAt: clock(),
    onApplyBaseline: (next) => { changedBaseline = next; return saveOverride(next, changedStorage.storage); },
    onChange: (source) => saveWallPicks([null, source, null, null], changedStorage.storage).ok,
  });
  assert.equal(freshStatus, "Loaded: Recorded episode");
  assert.equal(changedBaseline?.version, 8);
  assert.deepEqual(changedStorage.writes, [OVERRIDE_KEY, WALL_PICKS_KEY]);

  const blocked: WallPickStorage = {
    getItem: () => { throw new Error("blocked read"); },
    setItem: () => { throw new Error("blocked write"); },
    removeItem: () => { throw new Error("blocked removal"); },
  };
  assert.match(loadWallPicks(blocked).error!, /storage failed/);
  assert.equal(saveWallPicks(savedPicks, blocked).ok, false);
  assert.equal(clearWallPicks(blocked).ok, false);
  assert.match(loadWallPicks(null).error!, /storage failed/);
  const failedPanelStatus = commitResolvedRumblePaste({
    baseline: fixture, current: toSource(fixture.items[2], fixture), active: true,
    media, pageUrl: page, pastedAt: clock(), onApplyBaseline: saveBaseline,
    onChange: (source) => saveWallPicks([source, null, null, null], blocked).ok,
  });
  assert.match(failedPanelStatus, /Panel pick storage failed/);
  assert.equal(baselineWrites, 0);
  const failedBaselineStatus = commitResolvedRumblePaste({
    baseline: fixture, current: toSource(fixture.items[2], fixture), active: true,
    media: changedMedia, pageUrl: "https://rumble.com/v2aaaa-new.html", pastedAt: clock(),
    onApplyBaseline: () => false, onChange: () => true,
  });
  assert.match(failedBaselineStatus, /Baseline storage failed/);

  const renderWall = (storage: WallPickStorage | null, initialBaseline = fixture) =>
    renderToStaticMarkup(createElement(RumbleNewsWall, { storage, clock, initialBaseline }));
  const originalFetch = globalThis.fetch;
  let renderNetworkCalls = 0;
  globalThis.fetch = () => { renderNetworkCalls += 1; throw new Error("real network call in Rumble render test"); };
  try {
    const markup = renderWall(memory.storage);
    assert.match(markup, /data-testid="rumble-pasted-label"/);
    assert.match(markup, /link pasted <time datetime=/i);
    assert.ok(markup.includes(stamp), "rendered label holds the injected paste timestamp");
    assert.match(markup, /role="status"[^>]*>Restored saved panel pick\.<\/p>/);
    assert.ok(markup.includes(`src="https://rumble.com/embed/${media.embedId}/?pub=4"`), "restored pick renders its real iframe");
    const serverMarkup = renderWall(memory.storage, server);
    assert.ok(serverMarkup.includes(`src="https://rumble.com/embed/${media.embedId}/?pub=4"`));
    const statusMarkup = (message: string) => renderToStaticMarkup(createElement(RumbleWallStatus, { message }));
    assert.match(statusMarkup(alreadyMessage), /role="status"[^>]*>Already showing this video<\/p>/);
    assert.match(statusMarkup(loadedMessage), /Loaded: Recorded episode \(already saved as this channel&#x27;s latest\)/);
    assert.match(statusMarkup(failedPanelStatus), /Panel pick storage failed/);
    assert.match(statusMarkup(failedBaselineStatus), /Baseline storage failed/);
    assert.match(renderWall(blocked), /Panel pick storage failed/);
    assert.match(renderWall(null), /Panel pick storage failed/);
    const invalidStored = [
      "{broken",
      "x".repeat(MAX_WALL_PICK_CHARS + 1),
      JSON.stringify({ version: 2, panels: savedPicks }),
      JSON.stringify({ version: 1, panels: [] }),
      JSON.stringify({ version: 1, panels: [{ ...restored[2], embedId: "javascript:bad" }, null, null, null] }),
      JSON.stringify({ version: 1, panels: [{ ...restored[2], pastedAt: "invalid date" }, null, null, null] }),
      JSON.stringify({ version: 1, panels: [{ ...restored[2], pageUrl: "https://evil.example/video" }, null, null, null] }),
    ];
    for (const raw of invalidStored) {
      const corrupt = makeStorage();
      corrupt.values.set(WALL_PICKS_KEY, raw);
      const loaded = loadWallPicks(corrupt.storage);
      assert.deepEqual(loaded.picks, [null, null, null, null]);
      assert.match(loaded.error!, /storage failed/);
      assert.match(renderWall(corrupt.storage), /Panel pick storage failed/);
      assert.equal(corrupt.writes.length, 0, "corrupted/oversized storage is not silently rewritten");
    }
    assert.equal(renderNetworkCalls, 0, "server render tests never make real network calls");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(clearWallPicks(memory.storage).ok, true);
  assert.deepEqual(memory.removals, [WALL_PICKS_KEY], "Reset uses the exact panel-pick key");
  assert.equal(memory.values.has(WALL_PICKS_KEY), false);
  assert.deepEqual(loadWallPicks(memory.storage), { picks: [null, null, null, null], error: null });
  assert.equal(restoreWallSlots(fixture, loadWallPicks(memory.storage).picks, clock().getTime())[0].channelId, "news-rt");
  assert.ok(!restoreWallSlots(fixture, loadWallPicks(memory.storage).picks, clock().getTime()).some((source) => source.channelId === "c1"), "Reset releases the pasted VOD panel preference");
  assert.equal(clearWallPicks(changedStorage.storage).ok, true);
  assert.equal(changedStorage.values.has(OVERRIDE_KEY), true, "Reset picks does not delete the separately saved baseline");
  console.log("[rumble-picks] PASS — baseline no-op versus panel load, injected paste time, reload/server preservation, reset, stale-live priority, manual/default uniqueness, distinct War Rooms and storage failures");
  console.log("[rumble-render] PASS — actual wall restored label/status/iframe, no-op/load/failure status lines, corrupted/oversized/blocked storage and zero network calls");
}

console.log("[news-resolver] PASS: provider parsing guards, oEmbed resolver (success/cache/errors/timeout/no-cache-on-failure), YouTube stub through the same contract, client, route, channel picks.");
