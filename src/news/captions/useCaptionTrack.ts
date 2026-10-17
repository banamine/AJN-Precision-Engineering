import { useEffect, useRef, useState } from "react";
import { RequestBudget, SliceStore, parseProgramRef, wantedSlices, visibleLines, type CaptionKind, type Cue } from "./captionTrack";

export type CaptionState =
  | { phase: "off" }                                   // not a TV News program: no requests, no panel
  | { phase: "planning" }
  | { phase: "none" }                                  // the program has no caption file
  | { phase: "paused"; retryAfter: number }            // Archive asked us to slow down
  | { phase: "error"; reason: string }
  | { phase: "ready"; kind: CaptionKind; label: string; current: Cue | null; before: Cue[]; waiting: boolean };

interface ApiBody { error?: unknown; source?: unknown; retryAfter?: unknown; cues?: unknown; kind?: unknown; label?: unknown }
interface Plan { source: "none" | "align" | "cc5" | "asr"; kind?: CaptionKind; label?: string }
const TICK_MS = 500;
// Module-level so a new 282 s clip window of the same programme reuses what was already fetched.
const planMemo = new Map<string, Plan>();

/** Reads the playhead from the <video> element itself (not React state). `getVideo` may return null while the player swaps elements. */
export function useCaptionTrack(archivePath: string | undefined, getVideo: () => HTMLVideoElement | null): CaptionState {
  const ref = parseProgramRef(archivePath);
  const id = ref?.id ?? null;
  const clipStart = ref?.clipStart ?? 0;
  const [state, setState] = useState<CaptionState>(id ? { phase: "planning" } : { phase: "off" });
  const store = useRef(new SliceStore());
  const budget = useRef(new RequestBudget());
  const clipStartRef = useRef(clipStart);
  clipStartRef.current = clipStart;
  const getVideoRef = useRef(getVideo);
  getVideoRef.current = getVideo;

  useEffect(() => {
    store.current.clear();
    if (!id) { setState({ phase: "off" }); return; }
    let cancelled = false;
    let plan: Plan | null = planMemo.get(id) ?? null;
    let inflight = false;
    let pausedUntil = 0;
    let failedSlices = new Map<number, string>();   // one attempt per slice: no retry loop
    const ac = new AbortController();
    let planFailed = false;                          // one attempt per programme: no retry loop
    let lastKey = "";
    const show = (next: CaptionState) => {           // skip identical states so the panel is not re-rendered every tick
      const key = JSON.stringify(next);
      if (key === lastKey) return;
      lastKey = key; setState(next);
    };
    show({ phase: "planning" });

    async function getJson(url: string): Promise<{ status: number; body: ApiBody | null }> {
      budget.current.record(Date.now());
      const res = await fetch(url, { signal: ac.signal, cache: "no-store" });
      let body: ApiBody | null = null;
      try { body = (await res.json()) as ApiBody; } catch { /* error body is optional */ }
      return { status: res.status, body };
    }

    async function ensurePlan(): Promise<void> {
      if (plan || inflight || planFailed) return;
      if (!budget.current.canRequest(Date.now())) return;
      inflight = true;
      try {
        const { status, body } = await getJson(`/api/captions/plan?id=${encodeURIComponent(id!)}`);
        if (cancelled) return;
        if (status === 200 && body?.source) { plan = body as unknown as Plan; planMemo.set(id!, plan); }
        else if (status === 429) { pausedUntil = Date.now() + (Number(body?.retryAfter) || 30) * 1000; }
        else { planFailed = true; show({ phase: "error", reason: String(body?.error ?? `plan HTTP ${status}`) }); }
      } catch (e) { if (!cancelled && !ac.signal.aborted) { planFailed = true; show({ phase: "error", reason: "network" }); } }
      finally { inflight = false; }
    }

    async function fetchSlice(start: number): Promise<void> {
      if (!plan || plan.source === "none" || inflight) return;
      if (store.current.has(start) || failedSlices.has(start)) return;
      if (!budget.current.canRequest(Date.now())) return;
      inflight = true;
      try {
        const { status, body } = await getJson(`/api/captions/slice?id=${encodeURIComponent(id!)}&src=${plan.source}&start=${start}`);
        if (cancelled) return;
        if (status === 200 && Array.isArray(body?.cues)) store.current.put(start, body.cues as Cue[]);
        else if (status === 429) { pausedUntil = Date.now() + (Number(body?.retryAfter) || 30) * 1000; }
        else failedSlices.set(start, String(body?.error ?? `HTTP ${status}`));
      } catch (e) { if (!cancelled && !ac.signal.aborted) failedSlices.set(start, "network"); }
      finally { inflight = false; }
    }

    const timer = window.setInterval(() => {
      if (cancelled) return;
      const now = Date.now();
      if (pausedUntil > now) { show({ phase: "paused", retryAfter: Math.ceil((pausedUntil - now) / 1000) }); return; }
      if (!plan) { void ensurePlan(); return; }
      if (plan.source === "none") { show({ phase: "none" }); return; }
      const video = getVideoRef.current();
      if (!video || !Number.isFinite(video.currentTime)) return;
      const position = clipStartRef.current + video.currentTime;   // seconds from the start of the programme
      store.current.prune(position);
      const wanted = wantedSlices(position);
      const missing = wanted.find((s) => !store.current.has(s) && !failedSlices.has(s));
      if (missing !== undefined && !video.paused) void fetchSlice(missing);
      const kind = plan.kind as CaptionKind;
      const { current, before } = visibleLines(store.current.cues(), position, kind);
      const currentFailed = failedSlices.get(wanted[0]);
      if (currentFailed && !store.current.has(wanted[0])) { show({ phase: "error", reason: currentFailed }); return; }
      show({ phase: "ready", kind, label: String(plan.label ?? ""), current, before, waiting: !store.current.has(wanted[0]) });
    }, TICK_MS);

    return () => { cancelled = true; window.clearInterval(timer); ac.abort(); };
  }, [id]);

  return state;
}
