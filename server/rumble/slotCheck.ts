import type { ResolveFailure, ResolveResult } from "../../src/news/contract";
import { rumblePageUrlForVideoId } from "../../src/news/providers/rumble";
import type { RumbleBaseline, RumbleItem, SlotLiveHint, SlotStatus, SlotStatusReport } from "../../src/rumble/types";

/**
 * Read-only slot check. Re-resolves every BAKED baseline item through the existing news resolver
 * (no second fetcher) and reports what it saw. It never rewrites the baseline and never guesses:
 * a slot that was not checked says so.
 */
export const SLOT_CHECK_TTL_MS = 5 * 60_000;
export const SLOT_CHECK_MIN_INTERVAL_MS = 60_000;
export const SLOT_CHECK_CONCURRENCY = 3;

export type SlotResolver = (input: string) => Promise<ResolveResult>;

const STOP_REASONS: ReadonlySet<ResolveFailure> = new Set(["rate-limited", "timeout"]);

const normTitle = (text: string): string => text.replace(/\s+/g, " ").trim().toLowerCase();

/** HINT only: durationSec 0 on a live item means still live; > 0 means it has a length (ended or VOD). */
export function liveHintFor(item: Pick<RumbleItem, "kind" | "state">, durationSec: number | null): SlotLiveHint | null {
  const liveItem = item.kind === "live" || item.kind === "continuous_live" || item.state === "live";
  if (!liveItem || durationSec === null) return null;
  return durationSec === 0 ? "live" : "ended-or-vod";
}

function unchecked(item: RumbleItem, reason: ResolveFailure): SlotStatus {
  return { channelId: item.channelId, videoId: item.videoId, status: "unchecked", reason, resolvedAt: null, titleChanged: null, embedIdMatches: null, liveHint: null };
}

async function checkOne(item: RumbleItem, resolve: SlotResolver): Promise<SlotStatus | { stop: ResolveFailure }> {
  let result: ResolveResult;
  try {
    result = await resolve(item.pageUrl ?? rumblePageUrlForVideoId(item.videoId));
  } catch {
    result = { ok: false, reason: "upstream-error" };
  }
  if (result.ok === false) {
    if (STOP_REASONS.has(result.reason)) return { stop: result.reason };
    return { channelId: item.channelId, videoId: item.videoId, status: "failed", reason: result.reason, resolvedAt: null, titleChanged: null, embedIdMatches: null, liveHint: null };
  }
  const media = result.media; // narrowed: ok === true (tsconfig has no strictNullChecks, so `!result.ok` would not narrow)
  return {
    channelId: item.channelId,
    videoId: item.videoId,
    status: "ok",
    resolvedAt: media.resolvedAt,
    titleChanged: normTitle(media.title) !== normTitle(item.title),
    embedIdMatches: media.embedId === item.embedId,
    liveHint: liveHintFor(item, media.durationSec),
  };
}

export async function runSlotCheck(
  baseline: RumbleBaseline,
  resolve: SlotResolver,
  now: () => number = Date.now,
  concurrency = SLOT_CHECK_CONCURRENCY,
): Promise<SlotStatusReport> {
  const items = baseline.items;
  const slots: SlotStatus[] = new Array(items.length);
  let next = 0;
  let stoppedEarly: ResolveFailure | null = null;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      const item = items[index];
      if (!item.videoId) {
        slots[index] = { channelId: item.channelId, videoId: item.videoId, status: "unchecked-embed-only", resolvedAt: null, titleChanged: null, embedIdMatches: null, liveHint: null };
        continue;
      }
      if (stoppedEarly) {
        slots[index] = unchecked(item, stoppedEarly);
        continue;
      }
      const outcome = await checkOne(item, resolve);
      if ("stop" in outcome) {
        stoppedEarly = stoppedEarly ?? outcome.stop;
        slots[index] = unchecked(item, outcome.stop);
      } else {
        slots[index] = outcome;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), Math.max(1, items.length)) }, worker));

  const count = (status: SlotStatus["status"]): number => slots.filter((slot) => slot.status === status).length;
  return {
    ok: true,
    checkedAt: new Date(now()).toISOString(),
    baselineVersion: baseline.version,
    baselineGeneratedAt: baseline.generatedAt,
    counts: { ok: count("ok"), failed: count("failed"), unchecked: count("unchecked"), uncheckedEmbedOnly: count("unchecked-embed-only") },
    stoppedEarly,
    slots,
  };
}

export interface SlotChecker {
  /** Cached report, a shared in-flight pass, or a new pass. Never throws. */
  get(): Promise<SlotStatusReport>;
  /** Number of passes started (for tests). */
  readonly passes: number;
}

/**
 * Single-flight + cache. Two simultaneous callers on a cold cache share ONE pass.
 * A complete pass is cached 5 min; a pass that stopped early is cached only 60 s, so a retry
 * can never come faster than one per minute.
 */
export function createSlotChecker(
  getBaseline: () => RumbleBaseline,
  resolve: SlotResolver,
  now: () => number = Date.now,
): SlotChecker {
  let cache: { report: SlotStatusReport; at: number; ttl: number } | null = null;
  let inflight: Promise<SlotStatusReport> | null = null;
  let passes = 0;

  return {
    get passes() { return passes; },
    get(): Promise<SlotStatusReport> {
      if (cache && now() - cache.at < cache.ttl) return Promise.resolve(cache.report);
      if (inflight) return inflight;
      passes += 1;
      inflight = runSlotCheck(getBaseline(), resolve, now)
        .then((report) => {
          cache = { report, at: now(), ttl: report.stoppedEarly ? SLOT_CHECK_MIN_INTERVAL_MS : SLOT_CHECK_TTL_MS };
          return report;
        })
        .finally(() => { inflight = null; });
      return inflight;
    },
  };
}
