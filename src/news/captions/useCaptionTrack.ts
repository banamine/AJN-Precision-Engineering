import { useEffect, useRef, useState } from "react";
import { RequestBudget, SliceStore, parseProgramRef, wantedSlices, visibleLines, type CaptionKind, type Cue } from "./captionTrack";

export type CaptionState =
  | { phase: "off" }                                   // not a TV News program: no requests, no panel
  | { phase: "planning" }
  | { phase: "none" }                                  // the program has no caption file
  | { phase: "paused"; retryAfter: number }            // Archive asked us to slow down
  | { phase: "error"; reason: string }
  | { phase: "ready"; kind: CaptionKind; label: string; current: Cue | null; before: Cue[]; waiting: boolean };

export interface CaptionApiBody {
  error?: unknown;
  message?: unknown;
  source?: unknown;
  retryAfter?: unknown;
  cues?: unknown;
  kind?: unknown;
  label?: unknown;
}
export interface CaptionPlan { source: "none" | "align" | "cc5" | "asr"; kind?: CaptionKind; label?: string }
export interface CaptionTrackAdapter {
  id: string | null;
  /** Keep independent media sources from sharing a cached plan accidentally. */
  memoKey?: string;
  planUrl: string;
  sliceUrl: (start: number, plan: CaptionPlan) => string;
  parsePlan: (status: number, body: CaptionApiBody | null) => CaptionPlan | null;
  getMedia: () => HTMLMediaElement | null;
  /** Offset from the media element's local time to the parent's absolute programme time. */
  positionOffset?: number;
  kind?: CaptionKind;
  label?: string;
  errorReason?: (status: number, body: CaptionApiBody | null) => string;
  retryAfterSeconds?: (body: CaptionApiBody | null, header: string | null) => number;
  /** News keeps its existing cool-down behavior; radio marks a 429 slice as attempted once. */
  rateLimitMode?: "cooldown-retry" | "single-attempt";
}
interface JsonReply { status: number; body: CaptionApiBody | null; retryAfterHeader: string | null }
const TICK_MS = 500;
// Module-level so the same programme reuses its plan across 282 s clip windows/remounts.
const planMemo = new Map<string, CaptionPlan>();

/** Reads the playhead from the <video> element itself (not React state). `getVideo` may return null while the player swaps elements. */
export function useCaptionTrack(archivePath: string | undefined, getVideo: () => HTMLVideoElement | null): CaptionState {
  const ref = parseProgramRef(archivePath);
  const id = ref?.id ?? null;
  const clipStart = ref?.clipStart ?? 0;
  return useCaptionTrackAdapter({
    id,
    planUrl: id ? `/api/captions/plan?id=${encodeURIComponent(id)}` : "",
    sliceUrl: (start, plan) => `/api/captions/slice?id=${encodeURIComponent(id ?? "")}&src=${plan.source}&start=${start}`,
    parsePlan: (status, body) => status === 200 && body?.source
      ? body as unknown as CaptionPlan
      : null,
    getMedia: getVideo,
    positionOffset: clipStart,
    errorReason: (status, body) => String(body?.error ?? `plan HTTP ${status}`),
  });
}

/** One playhead/slice/budget lifecycle shared by TV News and radio source adapters. */
export function useCaptionTrackAdapter(adapter: CaptionTrackAdapter): CaptionState {
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;
  const id = adapter.id;
  const memoKey = adapter.memoKey ?? id ?? "";
  const [state, setState] = useState<CaptionState>(id ? { phase: "planning" } : { phase: "off" });
  const store = useRef(new SliceStore());
  const budget = useRef(new RequestBudget());

  useEffect(() => {
    store.current.clear();
    if (!id) { setState({ phase: "off" }); return; }
    let cancelled = false;
    let plan: CaptionPlan | null = planMemo.get(memoKey) ?? null;
    let inflight = false;
    let pausedUntil = 0;
    let failedSlices = new Map<number, string>();   // one attempt per slice: no retry loop
    const ac = new AbortController();
    let planFailed = false;                          // one attempt per programme: no retry loop
    let planFailureReason = "";
    let lastKey = "";
    const show = (next: CaptionState) => {           // skip identical states so the panel is not re-rendered every tick
      const key = JSON.stringify(next);
      if (key === lastKey) return;
      lastKey = key; setState(next);
    };
    show({ phase: "planning" });

    async function getJson(url: string): Promise<JsonReply> {
      budget.current.record(Date.now());
      const res = await fetch(url, { signal: ac.signal, cache: "no-store" });
      let body: CaptionApiBody | null = null;
      try { body = (await res.json()) as CaptionApiBody; } catch { /* error body is optional */ }
      return { status: res.status, body, retryAfterHeader: res.headers.get("Retry-After") };
    }

    function reason(status: number, body: CaptionApiBody | null, fallback: string): string {
      const current = adapterRef.current;
      return current.errorReason ? current.errorReason(status, body) : String(body?.error ?? fallback);
    }

    function retrySeconds(body: CaptionApiBody | null, header: string | null): number {
      const current = adapterRef.current;
      return current.retryAfterSeconds
        ? current.retryAfterSeconds(body, header)
        : Number(body?.retryAfter) || 30;
    }

    async function ensurePlan(): Promise<void> {
      if (plan || inflight || planFailed) return;
      if (!budget.current.canRequest(Date.now())) return;
      inflight = true;
      try {
        const current = adapterRef.current;
        const { status, body, retryAfterHeader } = await getJson(current.planUrl);
        if (cancelled) return;
        const parsed = current.parsePlan(status, body);
        if (parsed) { plan = parsed; planMemo.set(memoKey, plan); }
        else if (status === 429) {
          pausedUntil = Date.now() + retrySeconds(body, retryAfterHeader) * 1000;
          if (current.rateLimitMode === "single-attempt") {
            planFailed = true;
            planFailureReason = reason(status, body, `plan HTTP ${status}`);
          }
        } else { planFailed = true; planFailureReason = reason(status, body, `plan HTTP ${status}`); show({ phase: "error", reason: planFailureReason }); }
      } catch { if (!cancelled && !ac.signal.aborted) { planFailed = true; planFailureReason = "network"; show({ phase: "error", reason: "network" }); } }
      finally { inflight = false; }
    }

    async function fetchSlice(start: number): Promise<void> {
      if (!plan || plan.source === "none" || inflight) return;
      if (store.current.has(start) || failedSlices.has(start)) return;
      if (!budget.current.canRequest(Date.now())) return;
      inflight = true;
      try {
        const current = adapterRef.current;
        const { status, body, retryAfterHeader } = await getJson(current.sliceUrl(start, plan));
        if (cancelled) return;
        if (status === 200 && Array.isArray(body?.cues)) store.current.put(start, body.cues as Cue[]);
        else if (status === 429) {
          pausedUntil = Date.now() + retrySeconds(body, retryAfterHeader) * 1000;
          if (current.rateLimitMode === "single-attempt") failedSlices.set(start, reason(status, body, `HTTP ${status}`));
        } else failedSlices.set(start, reason(status, body, `HTTP ${status}`));
      } catch { if (!cancelled && !ac.signal.aborted) failedSlices.set(start, "network"); }
      finally { inflight = false; }
    }

    const timer = window.setInterval(() => {
      if (cancelled) return;
      const now = Date.now();
      if (pausedUntil > now) { show({ phase: "paused", retryAfter: Math.ceil((pausedUntil - now) / 1000) }); return; }
      if (!plan) {
        if (planFailed) { show({ phase: "error", reason: planFailureReason || "unavailable" }); return; }
        void ensurePlan(); return;
      }
      if (plan.source === "none") { show({ phase: "none" }); return; }
      const currentAdapter = adapterRef.current;
      const media = currentAdapter.getMedia();
      if (!media || !Number.isFinite(media.currentTime)) return;
      const position = (currentAdapter.positionOffset ?? 0) + media.currentTime;
      store.current.prune(position);
      const wanted = wantedSlices(position);
      const missing = wanted.find((s) => !store.current.has(s) && !failedSlices.has(s));
      if (missing !== undefined && !media.paused) void fetchSlice(missing);
      const kind = currentAdapter.kind ?? plan.kind as CaptionKind;
      const { current: activeCue, before } = visibleLines(store.current.cues(), position, kind);
      const currentFailed = failedSlices.get(wanted[0]);
      if (currentFailed && !store.current.has(wanted[0])) { show({ phase: "error", reason: currentFailed }); return; }
      show({ phase: "ready", kind, label: String(currentAdapter.label ?? plan.label ?? ""), current: activeCue, before, waiting: !store.current.has(wanted[0]) });
    }, TICK_MS);

    return () => { cancelled = true; window.clearInterval(timer); ac.abort(); };
  }, [id, memoKey]);

  return adapter.id ? state : { phase: "off" };
}
