import assert from "node:assert/strict";
import { appliableRows, applyPlan, handleOfUrl, MAX_IMPORT_ITEMS, parseExport, withLookup } from "./importer";
import { chooseBaseline, clearOverride, loadOverride, OVERRIDE_KEY, saveOverride } from "./override";
import { validateBaseline } from "../rumble/logic";
import { RUMBLE_BASELINE } from "../rumble/baseline";
import { lastKnownItem, listChannelPicks, staleChannelCount } from "../rumble/wall";

const NOW = new Date("2026-10-06T13:00:00.000Z");
const base = RUMBLE_BASELINE;

// handles
assert.equal(handleOfUrl("https://rumble.com/c/Redacted"), "redacted");
assert.equal(handleOfUrl("https://rumble.com/user/RealAmericasVoice"), "realamericasvoice");
assert.equal(handleOfUrl("https://evil.com/c/Redacted"), null);

// ---- rejects ----
for (const [input, fragment] of [
  ["", "Paste the JSON"],
  ["{nope", "not valid JSON"],
  ['{"a":1}', 'No "items"'],
  ['{"items":[]}', "no videos"],
  ["x".repeat(1_000_001), "too large"],
] as const) {
  const plan = parseExport(input, base, NOW);
  assert.equal(plan.ok, false);
  assert.ok(plan.errors[0].includes(fragment), `${input.slice(0, 10)} -> ${plan.errors[0]}`);
}
const many = JSON.stringify({ items: Array.from({ length: MAX_IMPORT_ITEMS + 1 }, (_, i) => ({ videoId: `v${i}aaaa` })) });
assert.equal(parseExport(many, base, NOW).ok, false);

// ---- a realistic export (shape of tools/export-rumble.js; its embedId is the PAGE id, which we must not trust) ----
const exportJson = JSON.stringify({
  version: 1,
  generatedAt: "2026-10-06T12:30:00.000Z",
  channels: [
    { id: "rumble-redacted", network: "other", name: "Redacted News", url: "https://rumble.com/c/Redacted" },
    { id: "rumble-bannonswarroom", network: "rav", name: "Bannons War Room", url: "https://rumble.com/c/BannonsWarRoom" },
    { id: "rumble-warroomrumble", network: "ajn", name: "War Room", url: "https://rumble.com/c/WarRoomRumble" },
    { id: "rumble-someoneelse", network: "other", name: "Someone Else", url: "https://rumble.com/c/SomeoneElse" },
    { id: "rumble-realamericasvoice", network: "rav", name: "Real America's Voice", url: "https://rumble.com/user/RealAmericasVoice" },
  ],
  items: [
    // Redacted: only recorded videos, newest must win by date, not by order or views
    { channelId: "rumble-redacted", videoId: "v7gold1", embedId: "v7gold1", title: "Older show", thumbnailUrl: null, publishedAt: "2026-10-01T10:00:00.000Z", startedAt: null, durationSec: 1200, kind: "vod", state: "vod", viewers: null },
    { channelId: "rumble-redacted", videoId: "v7gdv2i", embedId: "v7gdv2i", title: "The Horrifying Truth About Lethal Injection", thumbnailUrl: "https://hugh.cdn.rumble.cloud/video/x.jpg", publishedAt: "2026-10-05T18:00:00.000Z", startedAt: null, durationSec: 2335, kind: "vod", state: "vod", viewers: null },
    { channelId: "rumble-redacted", videoId: "v7gdv2i", embedId: "v7gdv2i", title: "dup of the same video", thumbnailUrl: null, publishedAt: "2026-10-05T18:00:00.000Z", startedAt: null, durationSec: 1, kind: "vod", state: "vod", viewers: null },
    // Two different War Room channels must stay two different channels
    { channelId: "rumble-bannonswarroom", videoId: "v7gbn01", embedId: "v7gbn01", title: "Bannon today", thumbnailUrl: "https://evil.com/t.jpg", publishedAt: "2026-10-06T08:00:00.000Z", startedAt: null, durationSec: 3000, kind: "vod", state: "vod", viewers: null },
    { channelId: "rumble-warroomrumble", videoId: "v7gws01", embedId: "v7gws01", title: "Harrison Smith show", thumbnailUrl: null, publishedAt: "2026-10-06T09:00:00.000Z", startedAt: null, durationSec: 3000, kind: "vod", state: "vod", viewers: null },
    { channelId: "rumble-someoneelse", videoId: "v7gxx01", embedId: "v7gxx01", title: "Not ours", thumbnailUrl: null, publishedAt: "2026-10-06T09:00:00.000Z", startedAt: null, durationSec: 10, kind: "vod", state: "vod", viewers: null },
    // Real America's Voice: unchanged (same video as the baseline's current live stream)
    { channelId: "rumble-realamericasvoice", videoId: "v7g6mii", embedId: "v7g6mii", title: "HOME OF REAL NEWS & HONEST VIEWS", thumbnailUrl: null, publishedAt: null, startedAt: "2026-09-30T09:00:00.000Z", durationSec: null, kind: "live", state: "live", viewers: 2410 },
    // junk
    { channelId: "rumble-redacted", videoId: "NOT AN ID", title: "bad", state: "vod" },
    { channelId: "rumble-redacted", videoId: "v7gbad2", title: "", state: "vod" },
    { channelId: "rumble-redacted", videoId: "v7gbad3", title: "weird state", state: "banana" },
  ],
});
const plan = parseExport(exportJson, base, NOW);
assert.equal(plan.ok, true);
assert.equal(plan.generatedAt, "2026-10-06T12:30:00.000Z");
assert.equal(plan.invalidItems, 3);
assert.deepEqual(plan.unknownHandles, ["someoneelse"]);
const row = (id: string) => plan.rows.find((r) => r.channelId === id)!;
assert.equal(row("news-redacted").status, "changed");
assert.equal(row("news-redacted").candidate.videoId, "v7gdv2i", "newest dated video wins; duplicate ignored");
assert.equal(row("news-redacted").pageUrl, "https://rumble.com/v7gdv2i-video.html");
assert.equal(row("news-redacted").embedId, null, "page id is never trusted as an embed id");
assert.equal(row("rav-bannons-war-room").status, "new");
assert.equal(row("rav-bannons-war-room").candidate.thumbnailUrl, null, "thumbnail on a foreign host is dropped, item kept");
assert.equal(row("ajn-war-room").candidate.videoId, "v7gws01");
assert.notEqual(row("ajn-war-room").channelId, row("rav-bannons-war-room").channelId, "the two War Rooms never merge");
assert.equal(row("rav-real-americas-voice").status, "unchanged");
assert.equal(row("rav-real-americas-voice").embedId, "v7g6mii".length ? base.items.find((i) => i.channelId === "rav-real-americas-voice")!.embedId : null);
assert.equal(plan.untouchedChannels, base.channels.length - plan.rows.length);

// future export time is clamped to now
const future = parseExport(exportJson.replace("2026-10-06T12:30:00.000Z", "2030-01-01T00:00:00.000Z"), base, NOW);
assert.equal(future.generatedAt, NOW.toISOString());

// ---- lookup + apply ----
assert.equal(appliableRows(plan.rows).length, 0, "nothing is appliable before the lookup");
const media = (embedId: string) => ({ media: { provider: "rumble" as const, embedId, embedSrc: `https://rumble.com/embed/${embedId}/?pub=4`, title: "t", author: null, thumbnailUrl: null, durationSec: null, resolvedAt: NOW.toISOString() } });
let rows = plan.rows.map((r) => {
  if (r.channelId === "news-redacted") return withLookup(r, media("v7e7i50"));
  if (r.channelId === "rav-bannons-war-room") return withLookup(r, media("v7ebn99"));
  if (r.channelId === "ajn-war-room") return withLookup(r, { reason: "The provider says that video does not exist (or is private)." });
  return r;
});
const ready = appliableRows(rows);
assert.deepEqual(ready.map((r) => r.channelId).sort(), ["news-redacted", "rav-bannons-war-room"]);
assert.equal(rows.find((r) => r.channelId === "ajn-war-room")!.status, "unresolved");

const next = applyPlan(base, { ...plan, rows });
assert.equal(next.version, base.version + 1);
assert.equal(next.generatedAt, "2026-10-06T12:30:00.000Z");
assert.equal(validateBaseline(next).valid, true);
const redacted = lastKnownItem(next, "news-redacted")!;
assert.equal(redacted.videoId, "v7gdv2i");
assert.equal(redacted.embedId, "v7e7i50", "embed id comes from the lookup, not the page id");
assert.equal(redacted.seenAt, "2026-10-06T12:30:00.000Z");
assert.equal(next.items.filter((i) => i.channelId === "news-redacted").length, 1, "applied channel is replaced, not appended");
// untouched channels keep their own age
const untouched = next.items.find((i) => i.channelId === "news-rt")!;
assert.equal(untouched.seenAt, base.generatedAt);
assert.equal(lastKnownItem(next, "ajn-war-room"), null, "failed lookup was not applied");
assert.equal(lastKnownItem(next, "rav-bannons-war-room")?.embedId, "v7ebn99");
// picks carry the right "as of"
const picks = listChannelPicks(next);
assert.equal(picks.find((p) => p.channelId === "news-redacted")!.asOf, "2026-10-06T12:30:00.000Z");
assert.equal(picks.find((p) => p.channelId === "news-rt")!.asOf, base.generatedAt);
assert.equal(picks.find((p) => p.channelId === "news-redacted")!.pageUrl, "https://rumble.com/v7gdv2i-video.html");
// stale count only counts the old ones
const stale = staleChannelCount(picks, NOW.getTime());
assert.equal(stale, picks.length - 2);

// ---- saved list in this browser ----
const store = new Map<string, string>();
const fake = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
assert.equal(loadOverride(fake), null);
assert.equal(saveOverride(next, fake), true);
assert.equal(loadOverride(fake)?.version, next.version);
store.set(OVERRIDE_KEY, "{broken");
assert.equal(loadOverride(fake), null, "corrupt saved list is ignored");
store.set(OVERRIDE_KEY, JSON.stringify({ ...next, items: [{ ...next.items[0], channelId: "ghost" }] }));
assert.equal(loadOverride(fake), null, "invalid saved list is ignored");
saveOverride(next, fake);
clearOverride(fake);
assert.equal(loadOverride(fake), null);
const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
assert.equal(loadOverride(blocked), null);
assert.equal(saveOverride(next, blocked), false);
clearOverride(blocked);
assert.equal(saveOverride(next, null), false);

// newest wins; a newer built-in list is never hidden by an old saved one; ties go to the later entry
const older = { ...next, generatedAt: "2026-09-01T00:00:00.000Z", version: 99 };
assert.equal(chooseBaseline([base, older]).generatedAt, base.generatedAt);
assert.equal(chooseBaseline([base, next]).version, next.version);
assert.equal(chooseBaseline([base, null]).version, base.version);

console.log("[news-importer] PASS: reject paths, export diff (changed/new/unchanged/unresolved), date-not-order newest, two War Rooms stay separate, embed id from lookup, per-channel 'as of', saved list + corruption/blocked storage, newest-wins.");
