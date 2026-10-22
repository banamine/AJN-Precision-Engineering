import type { CaptionState } from "./useCaptionTrack";

/** Shared view for TV News and radio caption tracks; no fetching or timing lives here. */
export function CaptionStrip({ state, compact = false }: { state: CaptionState; compact?: boolean }) {
  if (state.phase === "off") return null;
  const shell = `rounded-lg border border-neutral-800 bg-neutral-950 px-3 ${compact ? "py-1" : "py-2"} text-sm`;
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
