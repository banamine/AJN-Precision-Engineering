import assert from "node:assert/strict";
import type { RumbleBaseline, RumbleItem } from "../rumble/types";
import type { ResolvedMedia } from "./contract";
import { applyPastedVideo } from "./pastedVideo";

const NOW = new Date("2026-10-07T02:00:00.000Z");
const PAGE = "https://rumble.com/v7ge80c-there-is-no-such-thing-as-natural-weather.html?e9s=tracking#ignored";
const oldItem = (channelId: string, videoId: string, extra: Partial<RumbleItem> = {}): RumbleItem => ({
  channelId, videoId, embedId: "v7oldid", title: "Previous video",
  thumbnailUrl: null, publishedAt: null, durationSec: null,
  kind: "vod", state: "vod", viewers: null, ...extra,
});
const baseline: RumbleBaseline = {
  version: 5,
  generatedAt: "2026-10-06T12:00:00.000Z",
  channels: [
    { id: "news-redacted", network: "other", name: "Redacted", url: "https://rumble.com/c/Redacted" },
    { id: "news-rt", network: "other", name: "RT", url: "https://rumble.com/c/RT" },
  ],
  items: [
    oldItem("news-redacted", "v7old11"),
    oldItem("news-redacted", "v7old12"),
    oldItem("news-rt", "v7rtold"),
    oldItem("news-rt", "v7rtnew", { seenAt: "2026-10-06T15:00:00.000Z" }),
  ],
};
const media: ResolvedMedia = {
  provider: "rumble",
  embedId: "v7e7v2u",
  embedSrc: "https://rumble.com/embed/v7e7v2u/?pub=4",
  title: "A fresh Redacted video",
  author: "Redacted News",
  authorUrl: "https://rumble.com/c/redacted",
  thumbnailUrl: "https://hugh.cdn.rumble.cloud/video/test.jpg",
  durationSec: 1505,
  resolvedAt: NOW.toISOString(),
};
const original = JSON.stringify(baseline);
const result = applyPastedVideo(baseline, media, PAGE, NOW);
assert.equal(result.channelId, "news-redacted");
assert.equal(result.baseline.version, 6);
assert.equal(result.baseline.generatedAt, NOW.toISOString());
assert.equal(result.baseline.channels, baseline.channels);
assert.equal(JSON.stringify(baseline), original, "the input baseline is not mutated");
const fresh = result.baseline.items.filter((item) => item.channelId === "news-redacted");
assert.equal(fresh.length, 1, "all old items of the matched channel are replaced");
assert.deepEqual(fresh[0], {
  channelId: "news-redacted", videoId: "v7ge80c", embedId: media.embedId,
  pageUrl: "https://rumble.com/v7ge80c-there-is-no-such-thing-as-natural-weather.html",
  title: media.title, thumbnailUrl: media.thumbnailUrl, publishedAt: null,
  seenAt: NOW.toISOString(), durationSec: 1505, kind: "vod", state: "vod", viewers: null,
});
assert.deepEqual(
  result.baseline.items.filter((item) => item.channelId === "news-rt"),
  baseline.items.filter((item) => item.channelId === "news-rt")
    .map((item) => ({ ...item, seenAt: item.seenAt ?? baseline.generatedAt })),
  "other channels retain their content and original as-of times",
);
for (const authorUrl of [null, undefined, "https://rumble.com/c/Unknown", "https://example.com/c/Redacted"]) {
  const unchanged = applyPastedVideo(baseline, { ...media, authorUrl }, PAGE, NOW);
  assert.equal(unchanged.baseline, baseline, "unknown or missing authors return the same baseline");
  assert.equal(unchanged.channelId, null);
}
assert.equal(
  applyPastedVideo(baseline, { ...media, authorUrl: "https://rumble.com/user/REDACTED" }, PAGE, NOW).channelId,
  "news-redacted",
  "matching reuses the existing case-insensitive channel handle parser",
);
for (const thumbnailUrl of ["https://evil.com/image.jpg", "http://hugh.cdn.rumble.cloud/image.jpg", "not a URL"]) {
  const sanitized = applyPastedVideo(baseline, { ...media, thumbnailUrl }, PAGE, NOW).baseline.items;
  assert.equal(sanitized[sanitized.length - 1].thumbnailUrl, null);
}
assert.throws(() => applyPastedVideo(baseline, { ...media, embedId: "" }, PAGE, NOW), /invalid list.*embedId/);
assert.throws(() => applyPastedVideo(baseline, { ...media, durationSec: -1 }, PAGE, NOW), /invalid list.*durationSec/);
assert.throws(() => applyPastedVideo(baseline, media, "https://evil.com/v7ge80c-video.html", NOW), /not a Rumble video page/);
console.log("[pasted-video] PASS — matched replacement, unchanged unknown authors, clean URLs/thumbnails, preserved as-of, version, validation, and fixed time");
