import { useLayoutEffect, useRef, useState } from "react";
import type { CaptionState } from "./useCaptionTrack";

/** Shared view for TV News and radio caption tracks; no fetching or timing lives here. */
export type CaptionStripVariant = "inline" | "sidebar";

export function CaptionStrip({ state, compact = false, variant = "inline" }: { state: CaptionState; compact?: boolean; variant?: CaptionStripVariant }) {
  if (state.phase === "off") return null;
  const shell = `rounded-lg border border-neutral-800 bg-neutral-950 px-3 ${compact ? "py-1" : "py-2"} text-sm`;
  if (variant === "sidebar") return <CaptionSidebar state={state} compact={compact} shell={shell} />;
  if (state.phase === "planning") return <div data-testid="captions-planning" role="status" className={`${shell} text-neutral-400`}>Looking for captions…</div>;
  if (state.phase === "none") return <div data-testid="captions-none" role="status" className={`${shell} text-neutral-300`}>No captions for this program.</div>;
  if (state.phase === "paused") return <div data-testid="captions-paused" role="status" className={`${shell} text-amber-300`}>Captions paused: Internet Archive asked us to slow down. Resuming in about {state.retryAfter} s.</div>;
  if (state.phase === "error") return <div data-testid="captions-error" role="alert" className={`${shell} text-red-300`}>Captions unavailable ({state.reason}).</div>;
  return (
    <section data-testid="captions-panel" aria-label="Captions" className={shell}>
      <div data-testid="captions-label" className={`${compact ? "mb-0" : "mb-1"} text-[11px] uppercase tracking-wide text-neutral-400`}>{state.label}</div>
      <div aria-live="off" className="max-h-28 space-y-1 overflow-y-auto text-neutral-400">
        {state.before.map((cue) => <p key={`${cue.start}|${cue.text}`} className="leading-snug">{cue.text}</p>)}
      </div>
      <p data-testid="captions-current" aria-live="polite" className={`${compact ? "mt-0" : "mt-1"} min-h-[1.75rem] text-base font-medium leading-snug text-neutral-50`}>
        {state.current ? state.current.text : state.waiting ? "…" : ""}
      </p>
    </section>
  );
}

function CaptionSidebar({ state, compact, shell }: { state: CaptionState; compact: boolean; shell: string }) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const followingRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  useLayoutEffect(() => {
    if (state.phase !== "ready" || !followingRef.current) return;
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [state]);

  if (state.phase === "planning") return <div data-testid="captions-planning" role="status" className={`${shell} h-full min-h-0 text-neutral-400`}>Looking for captions…</div>;
  if (state.phase === "none") return <div data-testid="captions-none" role="status" className={`${shell} h-full min-h-0 text-neutral-300`}>No captions for this program.</div>;
  if (state.phase === "paused") return <div data-testid="captions-paused" role="status" className={`${shell} h-full min-h-0 text-amber-300`}>Captions paused: Internet Archive asked us to slow down. Resuming in about {state.retryAfter} s.</div>;
  if (state.phase === "error") return <div data-testid="captions-error" role="alert" className={`${shell} h-full min-h-0 text-red-300`}>Captions unavailable ({state.reason}).</div>;
  if (state.phase !== "ready") return null;

  const updateFollowState = () => {
    const list = listRef.current;
    if (!list) return;
    const atBottom = list.scrollHeight - list.clientHeight - list.scrollTop <= 24;
    followingRef.current = atBottom;
    setShowJump(!atBottom);
  };
  const jumpToLive = () => {
    followingRef.current = true;
    setShowJump(false);
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  };

  return (
    <section data-testid="captions-panel" aria-label="Captions" className={`${shell} flex h-full min-h-0 flex-col`}>
      <div data-testid="captions-label" className={`${compact ? "mb-0" : "mb-1"} shrink-0 text-[11px] uppercase tracking-wide text-neutral-400`}>{state.label}</div>
      <div
        ref={listRef}
        data-testid="captions-history"
        aria-live="off"
        onScroll={updateFollowState}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-1 text-neutral-400"
      >
        {state.before.map((cue) => <p key={`${cue.start}|${cue.text}`} className="leading-snug">{cue.text}</p>)}
        <p data-testid="captions-current" aria-live="polite" className="rounded-md border border-sky-500/20 bg-sky-950/50 p-2 text-base font-semibold leading-snug text-neutral-50">
          {state.current ? state.current.text : state.waiting ? "…" : ""}
        </p>
      </div>
      {showJump && <button type="button" data-testid="captions-jump-to-live" onClick={jumpToLive} className="mt-2 shrink-0 self-end rounded-md border border-neutral-700 px-2 py-1 text-xs font-medium text-sky-200 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">Jump to live</button>}
    </section>
  );
}
