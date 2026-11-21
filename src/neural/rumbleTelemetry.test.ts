import assert from "node:assert/strict";
import { NEURONS } from "./topology";
import { probeRumbleSlots, readNeuron, type RumbleEnv, type TelemetryEnv } from "./telemetry";
import { getWallState, iframeMounted, resetWallStateForTests, wallOpened } from "../rumble/wallState";
import type { SlotStatusReport } from "../rumble/types";

const NOW = Date.parse("2026-11-21T17:00:00.000Z");
const neuron = NEURONS.find((n) => n.id === "rumble-wall")!;
const baseEnv = (rumble?: RumbleEnv): TelemetryEnv => ({
  audio: null, video: null, jingle: { supported: false, playing: false, on: false }, sharedQuery: "",
  counts: { concerts: null, fm: null, rssFeeds: null, rssCollected: null, podcastFeeds: null },
  digest: null, frame: null, now: NOW, rumble,
});
const report = (over: Partial<SlotStatusReport> = {}): SlotStatusReport => ({
  ok: true, checkedAt: "2026-11-21T17:00:00.000Z", baselineVersion: 3, baselineGeneratedAt: "2026-09-30T20:47:09.621Z",
  counts: { ok: 2, failed: 1, unchecked: 0, uncheckedEmbedOnly: 0 }, stoppedEarly: null,
  slots: [
    { channelId: "a", videoId: "v1", status: "ok", resolvedAt: "x", titleChanged: true, embedIdMatches: true, liveHint: "ended-or-vod" },
    { channelId: "b", videoId: "v2", status: "ok", resolvedAt: "x", titleChanged: false, embedIdMatches: false, liveHint: "live" },
    { channelId: "c", videoId: "v3", status: "failed", reason: "not-found", resolvedAt: null, titleChanged: null, embedIdMatches: null, liveHint: null },
  ], ...over,
});
const GEN = "2026-09-30T20:47:09.621Z";

(async () => {
  // the neuron is wired to the rumble probe, and says "Not wired" without an env (no made-up value)
  assert.equal(neuron.probe, "rumble-wall");
  const bare = readNeuron(neuron, baseEnv());
  assert.equal(bare.state, "unwired");
  assert.equal(bare.headline, "Not wired");

  // wall not open: the count says so instead of a bare 0; slot check not run yet
  const closed = readNeuron(neuron, baseEnv({ baselineGeneratedAt: GEN, wall: { open: false, iframes: 0 }, slots: null }));
  assert.equal(closed.state, "idle");
  assert.equal(closed.payload, undefined);
  assert.match(closed.headline, /^Baked baseline 52 d old$/);
  assert.ok(closed.details.some((d) => d === "0 Rumble iframes (wall not open)"));
  assert.ok(closed.details.some((d) => d.startsWith("Slot check: not run")));

  // wall open with 2 mounted iframes: live, with a payload, and the real count
  const open = readNeuron(neuron, baseEnv({ baselineGeneratedAt: GEN, wall: { open: true, iframes: 2 }, slots: null }));
  assert.equal(open.state, "live");
  assert.equal(open.payload, "Rumble · 2 embeds mounted");
  assert.ok(open.details.includes("2 Rumble iframes mounted"));

  // wall open, nothing mounted yet: says 0 mounted (not "wall not open")
  const zero = readNeuron(neuron, baseEnv({ baselineGeneratedAt: GEN, wall: { open: true, iframes: 0 }, slots: null }));
  assert.ok(zero.details.includes("0 Rumble iframes mounted"));

  // slot report: numbers come straight from the report
  const withSlots = readNeuron(neuron, baseEnv({ baselineGeneratedAt: GEN, wall: { open: false, iframes: 0 }, slots: { ok: true, rttMs: 840, checkedAt: NOW - 120_000, report: report() } }));
  assert.equal(withSlots.state, "static");
  assert.ok(withSlots.details.some((d) => d.startsWith("Slots: 2 ok, 1 failed, 0 unchecked, 0 embed-only (checked 2 min ago, round trip 840 ms)")));
  assert.ok(withSlots.details.includes("Failed: c (not-found)"));
  assert.ok(withSlots.details.includes("1 title differs from the baseline"));
  assert.ok(withSlots.details.includes("1 embed id differs from the baseline (the wall plays the baseline id)"));
  assert.ok(withSlots.details.includes("1 live slot looks ended (hint only)"));

  // early stop and request failure are shown, not hidden
  const stopped = readNeuron(neuron, baseEnv({ baselineGeneratedAt: GEN, wall: { open: false, iframes: 0 }, slots: { ok: true, rttMs: 10, checkedAt: NOW, report: report({ stoppedEarly: "rate-limited" }) } }));
  assert.ok(stopped.details.includes("Pass stopped early: rate-limited"));
  const failed = readNeuron(neuron, baseEnv({ baselineGeneratedAt: GEN, wall: { open: false, iframes: 0 }, slots: { ok: false, rttMs: 55, checkedAt: NOW, error: "HTTP 500" } }));
  assert.ok(failed.details.includes("Slot check failed: HTTP 500 (after 55 ms)"));

  // unreadable baseline date is reported, not guessed
  const badDate = readNeuron(neuron, baseEnv({ baselineGeneratedAt: "garbage", wall: { open: false, iframes: 0 }, slots: null }));
  assert.equal(badDate.headline, "Baked baseline date unreadable");

  // probe: real request shape, typed failures
  let seenUrl = "";
  const okFetch = (async (url: string) => { seenUrl = url; return { ok: true, status: 200, json: async () => report() } as Response; }) as unknown as typeof fetch;
  const good = await probeRumbleSlots(okFetch, () => NOW, () => 0);
  assert.equal(seenUrl, "/api/rumble/slots/status");
  assert.equal(good.ok, true);
  assert.equal(good.report?.counts.ok, 2);
  const declined = await probeRumbleSlots((async () => ({ ok: true, status: 200, json: async () => ({ ok: false, reason: "disabled" }) })) as unknown as typeof fetch, () => NOW, () => 0);
  assert.deepEqual([declined.ok, declined.error], [false, "disabled"]);
  const httpErr = await probeRumbleSlots((async () => ({ ok: false, status: 503 })) as unknown as typeof fetch, () => NOW, () => 0);
  assert.equal(httpErr.error, "HTTP 503");
  const junk = await probeRumbleSlots((async () => ({ ok: true, status: 200, json: async () => ({ hello: 1 }) })) as unknown as typeof fetch, () => NOW, () => 0);
  assert.equal(junk.error, "unexpected response");
  const thrown = await probeRumbleSlots((async () => { throw new Error("network down"); }) as unknown as typeof fetch, () => NOW, () => 0);
  assert.deepEqual([thrown.ok, thrown.error], [false, "network down"]);

  // wall state store: counts only real mounts, idempotent release, resets when the wall closes
  resetWallStateForTests();
  assert.deepEqual(getWallState(), { open: false, iframes: 0 });
  const closeWall = wallOpened();
  const a = iframeMounted(), b = iframeMounted();
  assert.deepEqual(getWallState(), { open: true, iframes: 2 });
  a(); a();
  assert.equal(getWallState().iframes, 1);
  closeWall();
  assert.deepEqual(getWallState(), { open: false, iframes: 0 });
  b(); // a late panel cleanup after the wall closed must not go negative
  assert.equal(getWallState().iframes, 0);

  console.log("[rumble-telemetry] PASS: wired probe, Not-wired fallback, wall-not-open wording, real counts, slot report mapping, early stop, failures, probe, wall state.");
})().catch((error) => { console.error(error); process.exit(1); });
