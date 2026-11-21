import assert from "node:assert/strict";
import type { ResolveResult, ResolvedMedia } from "../news/contract";
import { registerRumbleRoutes } from "../../server/rumble/routes";
import { createSlotChecker, liveHintFor, runSlotCheck, SLOT_CHECK_CONCURRENCY, SLOT_CHECK_MIN_INTERVAL_MS, SLOT_CHECK_TTL_MS } from "../../server/rumble/slotCheck";
import type { RumbleBaseline, RumbleItem } from "./types";

const item = (overrides: Partial<RumbleItem> = {}): RumbleItem => ({
  channelId: "c1", videoId: "v1abc", embedId: "e1abc", title: "Live Show", thumbnailUrl: null,
  publishedAt: null, durationSec: null, kind: "live", state: "live", ...overrides,
});
const baseline = (items: RumbleItem[]): RumbleBaseline => ({
  version: 7, generatedAt: "2026-09-30T00:00:00.000Z",
  channels: [{ id: "c1", network: "ajn", name: "T", url: "https://rumble.com/c/t" }], items,
});
const media = (overrides: Partial<ResolvedMedia> = {}): ResolvedMedia => ({
  provider: "rumble", embedId: "e1abc", embedSrc: "https://rumble.com/embed/e1abc/?pub=4", title: "Live Show",
  author: null, thumbnailUrl: null, durationSec: 0, resolvedAt: "2026-11-21T17:00:00.000Z", ...overrides,
});
const ok = (m: Partial<ResolvedMedia> = {}): ResolveResult => ({ ok: true, media: media(m) });
const clock = () => { let t = Date.parse("2026-11-21T17:00:00.000Z"); return { now: () => t, advance: (ms: number) => { t += ms; } }; };

(async () => {
  // liveHint is a hint, and null when it cannot be known
  assert.equal(liveHintFor(item(), 0), "live");
  assert.equal(liveHintFor(item(), 3600), "ended-or-vod");
  assert.equal(liveHintFor(item(), null), null);
  assert.equal(liveHintFor(item({ kind: "vod", state: "vod" }), 600), null);

  // ok / changed title / embed mismatch / hint
  {
    const c = clock();
    const report = await runSlotCheck(baseline([
      item({ videoId: "va" }),
      item({ videoId: "vb", title: "Old title" }),
      item({ videoId: "vc", embedId: "other" }),
      item({ videoId: "vd", kind: "continuous_live" }),
    ]), async (input) => {
      if (input.includes("vb")) return ok({ title: "  new   TITLE " });
      if (input.includes("vd")) return ok({ durationSec: 900 });
      return ok();
    }, c.now);
    assert.equal(report.ok, true);
    assert.equal(report.baselineVersion, 7);
    assert.equal(report.checkedAt, "2026-11-21T17:00:00.000Z");
    assert.deepEqual(report.counts, { ok: 4, failed: 0, unchecked: 0, uncheckedEmbedOnly: 0 });
    assert.equal(report.slots[0].titleChanged, false);
    assert.equal(report.slots[0].embedIdMatches, true);
    assert.equal(report.slots[0].liveHint, "live");
    assert.equal(report.slots[1].titleChanged, true);
    assert.equal(report.slots[2].embedIdMatches, false);
    assert.equal(report.slots[3].liveHint, "ended-or-vod");
  }

  // failed: typed reason kept; nothing fabricated (null, never false)
  {
    const report = await runSlotCheck(baseline([item({ videoId: "va" }), item({ videoId: "vb" })]), async (input) =>
      input.includes("vb") ? { ok: false, reason: "not-found" } : ok());
    assert.equal(report.slots[1].status, "failed");
    assert.equal(report.slots[1].reason, "not-found");
    assert.equal(report.slots[1].titleChanged, null);
    assert.equal(report.slots[1].embedIdMatches, null);
    assert.equal(report.slots[1].liveHint, null);
    assert.equal(report.slots[1].resolvedAt, null);
    assert.equal(report.counts.failed, 1);
  }

  // a resolver that throws is a failure, not a crash
  {
    const report = await runSlotCheck(baseline([item()]), async () => { throw new Error("boom"); });
    assert.equal(report.slots[0].status, "failed");
    assert.equal(report.slots[0].reason, "upstream-error");
  }

  // embed-only entries are not resolved and are excluded from failure counts
  {
    let calls = 0;
    const report = await runSlotCheck(baseline([item({ videoId: "" })]), async () => { calls += 1; return ok(); });
    assert.equal(calls, 0);
    assert.equal(report.slots[0].status, "unchecked-embed-only");
    assert.deepEqual(report.counts, { ok: 0, failed: 0, unchecked: 0, uncheckedEmbedOnly: 1 });
  }

  // rate-limit stops the pass: nothing after it is resolved, all marked unchecked with the reason
  {
    let calls = 0;
    const items = Array.from({ length: 10 }, (_, i) => item({ videoId: `v${i}x` }));
    const report = await runSlotCheck(baseline(items), async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 5));
      return calls >= 2 ? { ok: false, reason: "rate-limited" } : ok();
    });
    assert.equal(report.stoppedEarly, "rate-limited");
    assert.ok(calls <= 2 + SLOT_CHECK_CONCURRENCY, `resolved ${calls} after the limit`);
    assert.ok(report.counts.unchecked >= 10 - calls);
    assert.ok(report.slots.filter((s) => s.status === "unchecked").every((s) => s.reason === "rate-limited"));
    assert.ok(report.slots.every((s) => s.status !== "ok" || s.titleChanged !== null));
  }

  // concurrency never exceeds the cap
  {
    let inFlight = 0, peak = 0;
    const items = Array.from({ length: 12 }, (_, i) => item({ videoId: `v${i}y` }));
    await runSlotCheck(baseline(items), async () => {
      inFlight += 1; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 3));
      inFlight -= 1;
      return ok();
    });
    assert.ok(peak <= SLOT_CHECK_CONCURRENCY && peak > 1, `peak ${peak}`);
  }

  // single-flight: two simultaneous calls on a cold cache share ONE pass
  {
    const c = clock();
    let calls = 0;
    const checker = createSlotChecker(() => baseline([item({ videoId: "va" }), item({ videoId: "vb" })]), async () => {
      calls += 1; await new Promise((r) => setTimeout(r, 5)); return ok();
    }, c.now);
    const [a, b] = await Promise.all([checker.get(), checker.get()]);
    assert.equal(a, b);
    assert.equal(checker.passes, 1);
    assert.equal(calls, 2);
    // cached for 5 min, then a new pass
    c.advance(SLOT_CHECK_TTL_MS - 1);
    await checker.get();
    assert.equal(checker.passes, 1);
    c.advance(2);
    await checker.get();
    assert.equal(checker.passes, 2);
  }

  // an early-stopped pass is retried no sooner than 60 s
  {
    const c = clock();
    const checker = createSlotChecker(() => baseline([item()]), async () => ({ ok: false, reason: "timeout" }), c.now);
    const first = await checker.get();
    assert.equal(first.stoppedEarly, "timeout");
    c.advance(SLOT_CHECK_MIN_INTERVAL_MS - 1);
    await checker.get();
    assert.equal(checker.passes, 1);
    c.advance(2);
    await checker.get();
    assert.equal(checker.passes, 2);
  }

  // route: registered, async, uses the baked baseline, always HTTP 200, honors the disabled flag
  {
    const handlers = new Map<string, Function>();
    registerRumbleRoutes({ get(p: string, h: Function) { handlers.set(p, h); }, post(p: string, h: Function) { handlers.set(p, h); } } as never,
      baseline([item({ videoId: "va" })]), async () => ok());
    const handler = handlers.get("/api/rumble/slots/status");
    assert.ok(handler, "route registered");
    const out: unknown[] = [];
    const res = { statusCode: 200, status(code: number) { res.statusCode = code; return res; }, json(body: unknown) { out.push(body); return res; } };
    await handler!({ query: {} }, res);
    const body = out[0] as { ok: boolean; counts: { ok: number }; baselineVersion: number };
    assert.equal(res.statusCode, 200);
    assert.equal(body.ok, true);
    assert.equal(body.counts.ok, 1);
    assert.equal(body.baselineVersion, 7);
    process.env.RUMBLE_ENGINE_ENABLED = "false";
    await handler!({ query: {} }, res);
    delete process.env.RUMBLE_ENGINE_ENABLED;
    assert.deepEqual(out[1], { ok: false, reason: "disabled" });
  }

  console.log("[rumble-slot-check] PASS: mapping, null-not-false, typed failures, embed-only, early stop, concurrency cap, single-flight, TTLs, route.");
})().catch((error) => { console.error(error); process.exit(1); });
