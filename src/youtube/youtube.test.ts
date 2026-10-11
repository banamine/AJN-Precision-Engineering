import assert from "node:assert/strict";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  getYoutubePlaylistCatalogErrors,
  getYoutubeRegistryErrors,
  isAllowedYoutubeHost,
  isAllowedYoutubeUrl,
  isYoutubeChannelId,
  isYoutubeHandle,
  isYoutubePlaylistId,
  isYoutubeRegistryId,
  isYoutubeVideoId,
  parseYoutubePlaylistId,
  validateYoutubePanels,
  validateYoutubePlaylistCatalog,
  validateYoutubePlaylistResolveResponse,
  validateYoutubeRegistry,
} from "./validate";
import { YOUTUBE_REGISTRY, pickRandomChannels } from "./registry";
import { loadAddedShows, loadPanelPicks, saveAddedShow, savePanelPicks } from "./panelMemory";
import playlistCatalogSeed from "../data/youtubePlaylists.json";
import { parseNewsInput } from "../news/registry";
import {
  openYoutubeShowListState,
  selectYoutubeShowState,
  YoutubePanel,
} from "../components/YoutubeWall";
import type { YoutubePlaylistCatalog } from "./types";
import { parseYoutubeFeed, resolveYoutubeChannelLatest, clearYoutubeLatestCache } from "../../server/youtube/resolve";
import {
  clearYoutubeRouteRateLimits,
  registerYoutubeRoutes,
  type FetchLike,
} from "../../server/youtube/routes";

const originalFetch = globalThis.fetch;
let realNetworkCalls = 0;
globalThis.fetch = () => {
  realNetworkCalls += 1;
  throw new Error("real network call in test");
};

try {
const filmriseChannel = YOUTUBE_REGISTRY.channels.find((channel) => channel.id === "yt-filmrise-television");
const filmriseCatalog = (playlistCatalogSeed as YoutubePlaylistCatalog).channels.find(
  (entry) => entry.registryId === "yt-filmrise-television",
);
if (!filmriseChannel || !filmriseCatalog?.playlists[0]) {
  throw new Error("FilmRise show-render test fixture is missing.");
}
type TestPanelState = ComponentProps<typeof YoutubePanel>["panel"];
const renderFilmRisePanel = (panel: TestPanelState) => renderToStaticMarkup(createElement(YoutubePanel, {
  index: 0,
  channels: [filmriseChannel],
  catalog: filmriseCatalog,
  addedShows: [],
  panel,
  onPanelChange: () => undefined,
  onChooseChannel: () => undefined,
  onSubmitVideo: () => undefined,
  onSelectShow: () => undefined,
  onAddShow: () => undefined,
  onShowLatest: () => undefined,
  onShowLive: () => undefined,
}));
const initialFilmRisePanel: TestPanelState = {
  selectedChannelId: filmriseChannel.id,
  video: null,
  latestVideo: null,
  error: null,
  busy: false,
  playing: false,
  openVideoId: null,
  activeTab: "shows",
  showListOpen: true,
  liveUnavailable: false,
};
const selectedFilmRisePanel = selectYoutubeShowState(
  initialFilmRisePanel,
  filmriseChannel,
  filmriseCatalog.playlists[0],
);
const selectedShowMarkup = renderFilmRisePanel(selectedFilmRisePanel);
const selectedShowSrc = `https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(filmriseCatalog.playlists[0].id)}&autoplay=1&enablejsapi=1`;
assert.equal(selectedFilmRisePanel.playing, true);
assert.equal(selectedFilmRisePanel.showListOpen, false);
assert.ok(selectedShowMarkup.includes(`src="${selectedShowSrc.replaceAll("&", "&amp;")}"`));
assert.ok(!selectedShowMarkup.includes('data-testid="youtube-shows-1"'));
const reopenedShowListMarkup = renderFilmRisePanel(openYoutubeShowListState(selectedFilmRisePanel));
assert.ok(reopenedShowListMarkup.includes('data-testid="youtube-shows-1"'));
console.log("[youtube-show-render] PASS — selected show renders its playing playlist iframe; Shows reopens the list");

/*
 * Recorded excerpt from a real response received 2026-10-06:
 * https://www.youtube.com/feeds/videos.xml?channel_id=UCupvZG-5ko_eiXAupbDfxWw
 * HTTP 200; the entry fragments below are copied from the returned Atom feed.
 * YouTube's top-level yt:channelId omitted "UC" in that response, while the
 * yt:channelId values inside each entry matched the full requested ID.
 */
const RECORDED_REAL_CNN_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <yt:channelId>upvZG-5ko_eiXAupbDfxWw</yt:channelId>
 <title>CNN</title>
 <author>
  <name>CNN</name>
  <uri>https://www.youtube.com/channel/UCupvZG-5ko_eiXAupbDfxWw</uri>
 </author>
 <entry>
  <id>yt:video:UEgCSrYvcj8</id>
  <yt:videoId>UEgCSrYvcj8</yt:videoId>
  <yt:channelId>UCupvZG-5ko_eiXAupbDfxWw</yt:channelId>
  <title>Paramount and Warner Bros. Discovery merger takes effect</title>
  <link rel="alternate" href="https://www.youtube.com/shorts/UEgCSrYvcj8"/>
  <author>
   <name>CNN</name>
   <uri>https://www.youtube.com/channel/UCupvZG-5ko_eiXAupbDfxWw</uri>
  </author>
  <published>2026-10-06T20:09:55+00:00</published>
  <updated>2026-10-06T20:57:54+00:00</updated>
  <media:group>
   <media:title>Paramount and Warner Bros. Discovery merger takes effect</media:title>
   <media:content url="https://www.youtube.com/v/UEgCSrYvcj8?version=3" type="application/x-shockwave-flash" width="640" height="390"/>
   <media:thumbnail url="https://i2.ytimg.com/vi/UEgCSrYvcj8/hqdefault.jpg" width="480" height="360"/>
   <media:description>The mega-merger of Paramount and Warner Bros. Discovery took effect on Tuesday, symbolizing Big Tech's ascendance in Hollywood. CNN's Brian Stelter reports.</media:description>
   <media:community>
    <media:starRating count="35" average="5.00" min="1" max="5"/>
    <media:statistics views="987"/>
   </media:community>
  </media:group>
 </entry>
 <entry>
  <id>yt:video:Hk2SKC1yhAs</id>
  <yt:videoId>Hk2SKC1yhAs</yt:videoId>
  <yt:channelId>UCupvZG-5ko_eiXAupbDfxWw</yt:channelId>
  <title>How can America dominate AI? Regulate it | Fareed’s Take</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=Hk2SKC1yhAs"/>
  <author>
   <name>CNN</name>
   <uri>https://www.youtube.com/channel/UCupvZG-5ko_eiXAupbDfxWw</uri>
  </author>
  <published>2026-10-06T20:00:12+00:00</published>
  <updated>2026-10-06T20:06:59+00:00</updated>
  <media:group>
   <media:title>How can America dominate AI? Regulate it | Fareed’s Take</media:title>
   <media:content url="https://www.youtube.com/v/Hk2SKC1yhAs?version=3" type="application/x-shockwave-flash" width="640" height="390"/>
   <media:thumbnail url="https://i1.ytimg.com/vi/Hk2SKC1yhAs/hqdefault.jpg" width="480" height="360"/>
   <media:description>In his take this week, CNN’s Fareed Zakaria says we are having a collective failure of imagination about artificial intelligence. Many closest to the technology have issued grave warnings and urged oversight, as the federal government has been mostly hands-off on regulation.

Fareed argues that proper regulation is actually the key to America winning in the AI race. Also, he talks to Microsoft co-founder Bill Gates on his foundation’s efforts to combat some of the negative effects of Artificial Intelligence and more.

0:00 How can America dominate in the AI race? Regulate it
6:18 Bill Gates calls AI an ‘evolutionary event’
8:35 Gates on what to do about AI right now
10:52 What jobs will be left in an AI world?

Watch 24/7 live news with CNN Headlines: https://bit.ly/4eIvlTr

#News #ai #fareedzakaria</media:description>
   <media:community>
    <media:starRating count="75" average="5.00" min="1" max="5"/>
    <media:statistics views="1907"/>
   </media:community>
  </media:group>
 </entry>
</feed>`;

assert.equal(isYoutubeChannelId("UCupvZG-5ko_eiXAupbDfxWw"), true);
assert.equal(isYoutubeChannelId("upvZG-5ko_eiXAupbDfxWw"), false);
assert.equal(isYoutubeHandle("News_Channel.1"), true);
assert.equal(isYoutubeHandle("x"), false);
assert.equal(isYoutubeHandle("bad handle"), false);
assert.equal(isYoutubeHandle("a".repeat(61)), false);
assert.equal(isYoutubeRegistryId("yt-cnn"), true);
assert.equal(isYoutubeRegistryId("YT-CNN"), false);
assert.equal(isYoutubeRegistryId("yt-a"), false);
assert.equal(isYoutubeVideoId("dQw4w9WgXcQ"), true);
assert.equal(isYoutubeVideoId("dQw4w9WgXc"), false);
assert.equal(isYoutubeVideoId("dQw4w9WgXcQ0"), false);
assert.equal(isYoutubePlaylistId("PLXtsaav09kxI"), true);
assert.equal(isYoutubePlaylistId("short"), false);
assert.equal(parseYoutubePlaylistId("https://www.youtube.com/playlist?list=PLXtsaav09kxI"), "PLXtsaav09kxI");
assert.equal(parseYoutubePlaylistId("https://youtube.com/watch?v=dQw4w9WgXcQ&list=PLXtsaav09kxI"), "PLXtsaav09kxI");
assert.equal(parseYoutubePlaylistId("https://youtu.be/dQw4w9WgXcQ?list=PLXtsaav09kxI"), "PLXtsaav09kxI");
for (const invalidPlaylistUrl of [
  "http://www.youtube.com/playlist?list=PLXtsaav09kxI",
  "https://youtube.com.evil.com/playlist?list=PLXtsaav09kxI",
  "https://user:pass@www.youtube.com/playlist?list=PLXtsaav09kxI",
  "https://www.youtube.com:8443/playlist?list=PLXtsaav09kxI",
  "https://www.youtube.com/playlist?list=PLXtsaav09kxI&list=PLfpTDN10MR5w",
  "PLXtsaav09kxI",
]) {
  assert.equal(parseYoutubePlaylistId(invalidPlaylistUrl), null, invalidPlaylistUrl);
}

for (const host of ["www.youtube.com", "i.ytimg.com", "www.youtube-nocookie.com"]) {
  assert.equal(isAllowedYoutubeHost(host), true);
}
for (const host of ["youtube.com", "youtube.com.evil.com", "www.youtube.com.evil.com", "evil.com"]) {
  assert.equal(isAllowedYoutubeHost(host), false);
}
assert.equal(isAllowedYoutubeUrl("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"), true);
assert.equal(isAllowedYoutubeUrl("http://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"), false);
assert.equal(isAllowedYoutubeUrl("https://www.youtube.com.evil.com/watch?v=dQw4w9WgXcQ"), false);
assert.equal(isAllowedYoutubeUrl("https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ"), false);
assert.equal(isAllowedYoutubeUrl("https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ"), false);

assert.equal(validateYoutubeRegistry(YOUTUBE_REGISTRY), true);
assert.equal(YOUTUBE_REGISTRY.channels.length, 59);
assert.ok(YOUTUBE_REGISTRY.channels.length > 0);
assert.deepEqual(YOUTUBE_REGISTRY.defaultSlots, ["yt-filmrise-television"]);
assert.deepEqual(YOUTUBE_REGISTRY.channels.at(-1), {
  id: "yt-filmrise-television",
  name: "FilmRise Television",
  handle: "FilmRiseTelevision",
  channelId: "UCVVXDVee0JZ2dlPYtpdTZVg",
  group: "entertainment",
  region: "us",
  main: true,
  verifiedAt: "2026-10-06",
});
assert.equal(YOUTUBE_REGISTRY.channels.filter((channel) => channel.main === true).length, 1);
assert.equal(validateYoutubeRegistry({
  ...YOUTUBE_REGISTRY,
  defaultSlots: ["yt-test-channel"],
  channels: [{
    id: "yt-test-channel",
    name: "No ranks",
    handle: "NoRanks",
    channelId: "UC0000000000000000000000",
    group: "entertainment",
    region: "us",
    main: true,
    verifiedAt: "2026-10-06",
  }],
}), true);

assert.equal(validateYoutubePlaylistCatalog(playlistCatalogSeed), true);
if (validateYoutubePlaylistCatalog(playlistCatalogSeed)) {
  assert.equal(playlistCatalogSeed.channels[0].playlists.length, 28);
  assert.equal(playlistCatalogSeed.channels[0].completeness, "partial");
  assert.equal(playlistCatalogSeed.channels[0].live.embedId, "6dUDnERMz8k");
  assert.equal(playlistCatalogSeed.channels[0].live.status, "unverified");
}
assert.ok(getYoutubePlaylistCatalogErrors({
  ...playlistCatalogSeed,
  channels: [{ ...playlistCatalogSeed.channels[0], completeness: "unknown" }],
}).some((error) => error.includes("channels[0] is invalid")));
assert.equal(validateYoutubePlaylistResolveResponse({ ok: true, playlist: {
  id: "PLXtsaav09kxI",
  title: "Series",
  thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  verifiedAt: "2026-10-06",
} }), true);
assert.ok(getYoutubeRegistryErrors({ ...YOUTUBE_REGISTRY, channels: [] }).includes("channels must not be empty"));
const tooManyChannels = {
  ...YOUTUBE_REGISTRY,
  channels: Array.from({ length: 151 }, (_, index) => ({
    ...YOUTUBE_REGISTRY.channels[0],
    id: `yt-test-${index}`,
    channelId: `UC${String(index).padStart(22, "0")}`,
  })),
};
assert.ok(getYoutubeRegistryErrors(tooManyChannels).includes("channels must not exceed 150"));
const duplicateRegistryIds = {
  ...YOUTUBE_REGISTRY,
  channels: [
    YOUTUBE_REGISTRY.channels[0],
    { ...YOUTUBE_REGISTRY.channels[1], id: YOUTUBE_REGISTRY.channels[0].id },
  ],
};
assert.ok(getYoutubeRegistryErrors(duplicateRegistryIds).some((error) => error.startsWith("duplicate registry id:")));
const duplicateChannelIds = {
  ...YOUTUBE_REGISTRY,
  channels: [
    YOUTUBE_REGISTRY.channels[0],
    { ...YOUTUBE_REGISTRY.channels[1], channelId: YOUTUBE_REGISTRY.channels[0].channelId },
  ],
};
assert.ok(getYoutubeRegistryErrors(duplicateChannelIds).some((error) => error.startsWith("duplicate channelId:")));
assert.equal(validateYoutubeRegistry({
  ...YOUTUBE_REGISTRY,
  channels: [{ ...YOUTUBE_REGISTRY.channels[0], group: "not-a-group" }],
}), false);

const validPanelSelections = [
  { videoId: "dQw4w9WgXcQ" },
  { videoId: "UEgCSrYvcj8" },
  { videoId: null },
  { videoId: null },
];
assert.equal(validateYoutubePanels(validPanelSelections), true);
assert.equal(validateYoutubePanels([...validPanelSelections, { videoId: null }]), false);
assert.equal(validateYoutubePanels([
  { videoId: "dQw4w9WgXcQ" },
  { videoId: "dQw4w9WgXcQ" },
]), false);
assert.equal(validateYoutubePanels([{ videoId: "invalid" }]), false);

const validWatch = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
assert.equal(parseNewsInput(validWatch)?.provider, "youtube");
assert.equal(parseNewsInput("https://youtu.be/dQw4w9WgXcQ")?.provider, "youtube");
assert.equal(parseNewsInput("dQw4w9WgXcQ")?.provider, "youtube");
assert.equal(parseNewsInput("v1234567890")?.provider, "youtube");
for (const rejected of [
  "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "https://evil.com/watch?v=dQw4w9WgXcQ",
  "https://www.youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
  "https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ",
  "https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ",
  "https://www.youtube.com:443/watch?v=dQw4w9WgXcQ",
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ&v=aaaaaaaaaaa",
  "https://www.youtube.com/shorts/dQw4w9WgXcQ",
]) {
  assert.equal(parseNewsInput(rejected), null, rejected);
}

const parsedFeed = parseYoutubeFeed(RECORDED_REAL_CNN_FEED, "UCupvZG-5ko_eiXAupbDfxWw");
assert.ok(parsedFeed);
assert.equal(parsedFeed.channelName, "CNN");
assert.equal(parsedFeed.video.videoId, "UEgCSrYvcj8");
assert.equal(parsedFeed.video.title, "Paramount and Warner Bros. Discovery merger takes effect");
assert.equal(parsedFeed.video.publishedAt, "2026-10-06T20:09:55+00:00");
assert.equal(parsedFeed.video.views, 987);
assert.equal(parseYoutubeFeed(RECORDED_REAL_CNN_FEED, "UC0000000000000000000000"), null);

const makeResponse = (body: string, status = 200): Response => new Response(body, { status });
clearYoutubeLatestCache();
let failureNotCachedCalls = 0;
let redirectMode: RequestRedirect | undefined;
const failThenSucceed = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  failureNotCachedCalls += 1;
  if (failureNotCachedCalls === 1) throw new Error("network down");
  redirectMode = init?.redirect;
  return makeResponse(RECORDED_REAL_CNN_FEED);
};
let firstFailureCalls = 0;
const firstFailureDelays: number[] = [];
const firstFailure = await resolveYoutubeChannelLatest("yt-cnn", {
  fetchImpl: async () => {
    firstFailureCalls += 1;
    throw new Error("network down");
  },
  sleep: async (milliseconds) => { firstFailureDelays.push(milliseconds); },
});
assert.deepEqual(firstFailure, { ok: false, reason: "upstream-error" });
assert.equal(firstFailureCalls, 3, "all three failed feed attempts use the injected fetch");
assert.deepEqual(firstFailureDelays, [400, 800], "failed feed attempts use the approved backoff");
const afterFailure = await resolveYoutubeChannelLatest("yt-cnn", {
  fetchImpl: failThenSucceed,
  sleep: async () => undefined,
});
assert.equal(afterFailure.ok, true);
assert.equal(failureNotCachedCalls, 2);
assert.equal(redirectMode, "error");

clearYoutubeLatestCache();
let intermittentAttempts = 0;
const retryDelays: number[] = [];
const retryThenSucceed = async (): Promise<Response> => {
  intermittentAttempts += 1;
  return intermittentAttempts < 3
    ? makeResponse("feed temporarily unavailable", 404)
    : makeResponse(RECORDED_REAL_CNN_FEED);
};
const retriedResult = await resolveYoutubeChannelLatest("yt-cnn", {
  fetchImpl: retryThenSucceed,
  sleep: async (milliseconds) => { retryDelays.push(milliseconds); },
});
assert.equal(retriedResult.ok, true);
assert.equal(intermittentAttempts, 3, "a temporary 404 is retried twice before success");
assert.deepEqual(retryDelays, [400, 800], "feed retries use the approved backoff");

clearYoutubeLatestCache();
const mismatchFeed = RECORDED_REAL_CNN_FEED.replace(
  /<yt:channelId>UCupvZG-5ko_eiXAupbDfxWw<\/yt:channelId>/g,
  "<yt:channelId>UC0000000000000000000000</yt:channelId>",
);
const mismatchResult = await resolveYoutubeChannelLatest("yt-cnn", {
  fetchImpl: async () => makeResponse(mismatchFeed),
  sleep: async () => undefined,
});
assert.deepEqual(mismatchResult, { ok: false, reason: "bad-response" });

clearYoutubeLatestCache();
let testNow = Date.parse("2026-10-06T21:00:00.000Z");
let staleCalls = 0;
const successThenFailure = async (): Promise<Response> => {
  staleCalls += 1;
  return staleCalls === 1
    ? makeResponse(RECORDED_REAL_CNN_FEED)
    : makeResponse("upstream unavailable", 503);
};
const freshResult = await resolveYoutubeChannelLatest("yt-cnn", {
  fetchImpl: successThenFailure,
  now: () => testNow,
  sleep: async () => undefined,
});
assert.equal(freshResult.ok, true);
testNow += 10 * 60 * 1000 + 1;
const staleResult = await resolveYoutubeChannelLatest("yt-cnn", {
  fetchImpl: successThenFailure,
  now: () => testNow,
  sleep: async () => undefined,
});
assert.equal(staleResult.ok, true);
if (staleResult.ok) {
  assert.equal(staleResult.stale, true);
  assert.equal(staleResult.reason, "upstream-error");
  assert.equal(staleResult.asOf, freshResult.ok ? freshResult.asOf : "");
}
assert.equal(staleCalls, 4, "a cached success survives all three retry attempts");

clearYoutubeLatestCache();
const oversizedFeed = await resolveYoutubeChannelLatest("yt-cnn", {
  fetchImpl: async () => makeResponse("x".repeat(512 * 1024 + 1)),
  sleep: async () => undefined,
});
assert.deepEqual(oversizedFeed, { ok: false, reason: "bad-response" });

clearYoutubeLatestCache();
const timeoutFeed = await resolveYoutubeChannelLatest("yt-cnn", {
  timeoutMs: 1,
  fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  }),
});
assert.deepEqual(timeoutFeed, { ok: false, reason: "timeout" });

clearYoutubeLatestCache();
let releasePending: (response: Response) => void = () => undefined;
let concurrentCalls = 0;
const pendingResponse = new Promise<Response>((resolve) => {
  releasePending = resolve;
});
const pendingFetch = async (): Promise<Response> => {
  concurrentCalls += 1;
  return pendingResponse;
};
const pendingLookups = [
  resolveYoutubeChannelLatest("yt-cnn", { fetchImpl: pendingFetch, sleep: async () => undefined }),
  resolveYoutubeChannelLatest("yt-pbs-newshour", { fetchImpl: pendingFetch, sleep: async () => undefined }),
  resolveYoutubeChannelLatest("yt-abc-news", { fetchImpl: pendingFetch, sleep: async () => undefined }),
];
const fourthLookup = await resolveYoutubeChannelLatest("yt-fox-news", { fetchImpl: pendingFetch });
assert.deepEqual(fourthLookup, { ok: false, reason: "rate-limited" });
assert.equal(concurrentCalls, 3);
releasePending(makeResponse(""));
await Promise.all(pendingLookups);

clearYoutubeLatestCache();
let unknownFetchCalls = 0;
const unknownChannel = await resolveYoutubeChannelLatest("evil", {
  fetchImpl: async () => {
    unknownFetchCalls += 1;
    return makeResponse(RECORDED_REAL_CNN_FEED);
  },
});
assert.deepEqual(unknownChannel, { ok: false, reason: "invalid-input" });
assert.equal(unknownFetchCalls, 0);

type TestResponse = {
  status: (code: number) => TestResponse;
  json: (value: unknown) => TestResponse;
};
type TestRequest = {
  query: Record<string, unknown>;
  body?: unknown;
  ip?: string;
  socket: { remoteAddress?: string };
};
type TestRoute = (req: TestRequest, res: TestResponse) => unknown;
const routes = new Map<string, TestRoute>();
let oembedRequestUrl: URL | null = null;
let oembedFetchCalls = 0;
registerYoutubeRoutes({
  get: (path, handler) => routes.set(path, handler as unknown as TestRoute),
  post: (path, handler) => routes.set(path, handler as unknown as TestRoute),
} as never, {
  fetchImpl: (async (input, init) => {
    oembedFetchCalls += 1;
    oembedRequestUrl = new URL(String(input));
    assert.equal(init?.redirect, "error");
    return new Response(JSON.stringify({
      type: "video",
      title: "New FilmRise Series",
      thumbnail_url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) satisfies FetchLike,
  now: () => Date.parse("2026-10-06T20:00:00.000Z"),
});
const invokeRoute = async (
  path: string,
  query: Record<string, unknown>,
  ip: string,
  body?: unknown,
) => {
  const handler = routes.get(path);
  assert.ok(handler, `Missing route ${path}`);
  let statusCode = 0;
  let responseBody: unknown;
  const response: TestResponse = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      responseBody = value;
      return this;
    },
  };
  await handler({ query, body, ip, socket: { remoteAddress: ip } }, response);
  return { statusCode, body: responseBody };
};

clearYoutubeRouteRateLimits();
const previousEnabled = process.env.YOUTUBE_WALL_ENABLED;
process.env.YOUTUBE_WALL_ENABLED = "true";
try {
  const channelsRoute = await invokeRoute("/api/youtube/channels", {}, "198.51.100.1");
  assert.equal(channelsRoute.statusCode, 200);
  assert.deepEqual(channelsRoute.body, YOUTUBE_REGISTRY);
  const invalidPlaylistRoute = await invokeRoute(
    "/api/youtube/playlist-resolve",
    {},
    "198.51.100.5",
    { url: "https://youtube.com.evil.com/playlist?list=PLXtsaav09kxI" },
  );
  assert.deepEqual(invalidPlaylistRoute.body, { ok: false, reason: "invalid-input" });
  assert.equal(oembedFetchCalls, 0, "untrusted playlist links never reach fetch");
  const playlistRoute = await invokeRoute(
    "/api/youtube/playlist-resolve",
    {},
    "198.51.100.6",
    { url: "https://youtube.com/playlist?list=PLXtsaav09kxI" },
  );
  assert.equal(playlistRoute.statusCode, 200);
  assert.deepEqual(playlistRoute.body, {
    ok: true,
    playlist: {
      id: "PLXtsaav09kxI",
      title: "New FilmRise Series",
      thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      verifiedAt: "2026-10-06",
    },
  });
  assert.ok(oembedRequestUrl);
  assert.equal(oembedRequestUrl?.origin, "https://www.youtube.com");
  assert.equal(oembedRequestUrl?.pathname, "/oembed");
  assert.equal(
    new URL(oembedRequestUrl?.searchParams.get("url") ?? "").searchParams.get("list"),
    "PLXtsaav09kxI",
  );
  const unknownRoute = await invokeRoute(
    "/api/youtube/channel-latest",
    { channel: "https://evil.com" },
    "198.51.100.2",
  );
  assert.deepEqual(unknownRoute, {
    statusCode: 200,
    body: { ok: false, reason: "invalid-input" },
  });
  clearYoutubeRouteRateLimits();
  for (let index = 0; index < 60; index += 1) {
    const withinLimit = await invokeRoute(
      "/api/youtube/channel-latest",
      { channel: "evil" },
      "198.51.100.4",
    );
    assert.deepEqual(withinLimit.body, { ok: false, reason: "invalid-input" });
  }
  const overLimit = await invokeRoute(
    "/api/youtube/channel-latest",
    { channel: "evil" },
    "198.51.100.4",
  );
  assert.deepEqual(overLimit.body, { ok: false, reason: "rate-limited" });
  clearYoutubeRouteRateLimits();
  process.env.YOUTUBE_WALL_ENABLED = "false";
  const disabledRoute = await invokeRoute(
    "/api/youtube/channel-latest",
    { channel: "yt-cnn" },
    "198.51.100.3",
  );
  assert.deepEqual(disabledRoute, {
    statusCode: 200,
    body: { ok: false, reason: "disabled" },
  });
} finally {
  if (previousEnabled === undefined) delete process.env.YOUTUBE_WALL_ENABLED;
  else process.env.YOUTUBE_WALL_ENABLED = previousEnabled;
}

// --- random default panels (pickRandomChannels) ---
{
  const seeded = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const all = YOUTUBE_REGISTRY.channels;
  const a = pickRandomChannels(all, 4, seeded(42));
  const b = pickRandomChannels(all, 4, seeded(42));
  assert.deepEqual(a.map((c) => c.id), b.map((c) => c.id), "same seed gives same picks");
  assert.equal(a.length, 4);
  assert.equal(new Set(a.map((c) => c.id)).size, 4, "picks are distinct");
  assert.ok(a.every((c) => all.includes(c)), "picks come from the registry");
  const sets = new Set<string>();
  for (let seed = 1; seed <= 20; seed++) {
    const picked = pickRandomChannels(all, 4, seeded(seed));
    assert.equal(new Set(picked.map((c) => c.id)).size, 4);
    sets.add(picked.map((c) => c.id).join(","));
  }
  assert.ok(sets.size > 1, "different seeds (Shuffle) change the set");
  assert.notDeepEqual(
    pickRandomChannels(all, 4, seeded(1)).map((c) => c.id),
    pickRandomChannels(all, 4, seeded(2)).map((c) => c.id),
  );
  assert.equal(pickRandomChannels(all.slice(0, 2), 4, seeded(7)).length, 2, "never more than the registry size");
  assert.equal(pickRandomChannels([], 4, seeded(7)).length, 0);
  assert.equal(pickRandomChannels(all, 0, seeded(7)).length, 0);
  const before = all.map((c) => c.id).join(",");
  pickRandomChannels(all, 4);
  assert.equal(all.map((c) => c.id).join(","), before, "input is not mutated");
  assert.equal(pickRandomChannels(all, 4, () => 1).length, 4, "rng at the upper edge stays in range");
  assert.equal(pickRandomChannels(all, 4, () => Number.NaN).length, 4, "bad rng output is tolerated");
  assert.equal(new Set(pickRandomChannels(all, 4).map((c) => c.id)).size, 4, "default Math.random works");
}

// --- remembered YouTube panel picks ---
{
  const validIds = new Set(YOUTUBE_REGISTRY.channels.map((channel) => channel.id));
  let storedValue: string | null = null;
  const storage = {
    getItem(key: string) {
      assert.equal(key, "ajn.wall.youtube.v1");
      return storedValue;
    },
    setItem(key: string, value: string) {
      assert.equal(key, "ajn.wall.youtube.v1");
      storedValue = value;
    },
  };
  const validPicks = ["yt-cnn", "", "yt-pbs-newshour", "yt-abc-news"];
  const encode = (picks: unknown, version = 1) => JSON.stringify({
    version,
    picks,
    savedAt: "2026-10-06T20:00:00.000Z",
  });

  assert.equal(savePanelPicks(validPicks, storage), true, "save picks");
  assert.deepEqual(loadPanelPicks(validIds, storage), validPicks, "round trip and preserve empty slot");
  assert.equal(JSON.parse(storedValue ?? "{}").savedAt, new Date(JSON.parse(storedValue ?? "{}").savedAt).toISOString());

  storedValue = "{";
  assert.equal(loadPanelPicks(validIds, storage), null, "corrupt JSON is ignored");

  storedValue = encode(validPicks, 2);
  assert.equal(loadPanelPicks(validIds, storage), null, "wrong version is ignored");

  storedValue = encode(["yt-cnn", "unknown", "yt-pbs-newshour", "yt-abc-news"]);
  assert.deepEqual(
    loadPanelPicks(validIds, storage),
    ["yt-cnn", "", "yt-pbs-newshour", "yt-abc-news"],
    "unknown ids are dropped without shifting slots",
  );

  storedValue = encode(["yt-cnn", "yt-cnn", "yt-pbs-newshour", "yt-abc-news"]);
  assert.deepEqual(
    loadPanelPicks(validIds, storage),
    ["yt-cnn", "", "yt-pbs-newshour", "yt-abc-news"],
    "duplicate ids keep their first slot",
  );

  storedValue = encode(["unknown-1", "unknown-2", "unknown-3", "unknown-4"]);
  assert.equal(loadPanelPicks(validIds, storage), null, "all unknown ids are ignored");

  storedValue = encode(["yt-cnn", "yt-pbs-newshour", "yt-abc-news"]);
  assert.equal(loadPanelPicks(validIds, storage), null, "wrong array length is ignored");

  assert.equal(
    loadPanelPicks(validIds, { getItem: () => { throw new Error("storage blocked"); } }),
    null,
    "getItem errors are ignored",
  );
  assert.equal(
    savePanelPicks(validPicks, { setItem: () => { throw new Error("storage full"); } }),
    false,
    "setItem errors return false",
  );
}

// --- browser-added playlists use a bounded, separate storage record ---
{
  const channel = playlistCatalogSeed.channels[0];
  const seededShows = channel.playlists;
  const customShow = {
    id: "PLNewShowId01",
    title: "A browser-added FilmRise show",
    thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    verifiedAt: "2026-10-06",
  };
  let storedShows: string | null = null;
  const showStorage = {
    getItem(key: string) {
      assert.equal(key, "youtube.shows.v1");
      return storedShows;
    },
    setItem(key: string, value: string) {
      assert.equal(key, "youtube.shows.v1");
      storedShows = value;
    },
  };
  assert.equal(saveAddedShow("yt-filmrise-television", customShow, seededShows, showStorage), true);
  assert.deepEqual(loadAddedShows("yt-filmrise-television", seededShows, showStorage), [customShow]);
  assert.equal(saveAddedShow("yt-filmrise-television", customShow, seededShows, showStorage), false);
  assert.equal(saveAddedShow(
    "yt-filmrise-television",
    seededShows[0],
    seededShows,
    showStorage,
  ), false, "a seeded playlist cannot be added a second time");
  assert.deepEqual(
    loadAddedShows("yt-filmrise-television", seededShows, { getItem: () => "x".repeat(48_001), setItem: () => undefined }),
    [],
    "oversized browser storage is ignored",
  );
  assert.equal(
    saveAddedShow("yt-filmrise-television", { ...customShow, thumbnailUrl: "https://evil.example/image.jpg" }, seededShows, showStorage),
    false,
    "untrusted thumbnails are rejected",
  );
}

assert.equal(realNetworkCalls, 0, "the YouTube test suite must never call global fetch");
console.log("[youtube] PASS — channel and playlist catalogs, safe resolution, RSS retry/cache/stale paths, routes, storage and distinct random picks");
console.log("[youtube-network-guard] PASS — zero global fetch calls");
} finally {
  globalThis.fetch = originalFetch;
}
