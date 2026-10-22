import { useEffect, useMemo, useRef, useState } from "react";
import notesJson from "../data/waitingNotes.json";
import { createDeck, waitKindOf, type Acronym, type Note, type WaitingNotesData } from "../utils/waitingNotes";

const DATA = notesJson as unknown as WaitingNotesData;

/** The waiting room: shown only while the player is REALLY waiting (loading / seeking / buffering / network stalled).
 *  A spinner, a made-up acronym for what is going on, and a rotating joke. The real status text and a live seconds counter
 *  stay on screen next to the joke, so the fun never hides what is actually happening. Retry appears only after a long wait. */
export function WaitingNotes({ status, onRetry, archive = false }: { status: string; onRetry?: () => void; archive?: boolean }) {
  const kind = waitKindOf(status);
  const { showAfterMs, rotateMs, retryAfterMs } = DATA.settings;
  const acrRotateMs = DATA.settings.archiveRotateMs ?? 4000;
  const deck = useMemo(() => createDeck(DATA), []);
  const startRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [note, setNote] = useState<Note | null>(null);
  const [acr, setAcr] = useState<Acronym | null>(null);
  const kindRef = useRef<string | null>(null);
  const poolKind = archive && kind ? 'archive' : kind;

  // one wait episode = from the first wait status until the status stops being a wait
  useEffect(() => {
    if (!kind) { startRef.current = null; kindRef.current = null; setElapsed(0); setNote(null); setAcr(null); return; }
    if (startRef.current === null) startRef.current = Date.now();
    if (kindRef.current !== poolKind) { kindRef.current = poolKind; setAcr(deck.acronym(poolKind as NonNullable<typeof poolKind>)); }
  }, [kind, poolKind, deck]);

  // Archive waits rotate the acronym every few seconds (the elapsed counter is real; only the joke changes)
  const acrSlot = Math.floor(elapsed / acrRotateMs);
  useEffect(() => { if (archive && kind && acrSlot > 0) setAcr(deck.acronym('archive')); }, [archive, kind, acrSlot, deck]);

  useEffect(() => {
    if (!kind) return;
    const tick = () => { if (startRef.current !== null) setElapsed(Date.now() - startRef.current); };
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [kind]);

  const visible = kind !== null && elapsed >= showAfterMs;
  const slot = Math.floor(elapsed / rotateMs);
  useEffect(() => { if (visible) setNote(deck.next(elapsed)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [visible, slot, deck]);

  if (!visible || !kind || !acr) return null;
  const secs = Math.floor(elapsed / 1000);
  return (
    <div data-testid="waiting-notes" data-kind={kind} data-source={archive ? "archive" : "other"} className="pointer-events-none absolute inset-x-3 bottom-14 z-30 flex justify-center sm:bottom-16">
      <div className="pointer-events-auto flex max-w-xl items-center gap-3 rounded-xl border border-white/10 bg-black/80 p-3 text-white shadow-xl backdrop-blur">
        <span aria-hidden="true" className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center">
          <span className="absolute inset-0 rounded-full border-2 border-sky-400/30" />
          <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-sky-300 motion-reduce:animate-none" />
          <span className="text-base">{note?.emoji ?? "⏳"}</span>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span data-testid="waiting-acronym" className="font-mono text-xs font-bold tracking-wider text-sky-300">{acr.short}</span>
            <span className="text-[11px] text-neutral-400">{acr.long}</span>
          </div>
          <p data-testid="waiting-note" className="mt-0.5 text-sm leading-snug text-neutral-100">{note?.text ?? ""}</p>
          <p role="status" data-testid="waiting-real-status" className="mt-1 text-[11px] text-neutral-400">
            {archive ? <>Waiting for Archive.org… {secs} s · {status.replace(/…+$/, "")}</> : <>{status.replace(/…+$/, "")} · {secs}s</>}
            {onRetry && elapsed >= retryAfterMs && (
              <>
                {" · "}
                <button type="button" onClick={onRetry} data-testid="playback-retry" className="rounded bg-white px-2 py-0.5 font-semibold text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">Retry</button>
              </>
            )}
          </p>
          {archive && elapsed >= DATA.settings.slowAfterMs && (
            <p data-testid="waiting-slow-source" className="mt-1 text-[11px] leading-snug text-amber-300">
              Archive.org is sending this file very slowly (the delay is on Archive's servers, not AJN). It may not play smoothly; Retry or pick another episode.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
