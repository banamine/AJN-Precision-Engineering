import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { Destination } from '../types';
import { GUIDE_CARDS } from './startGuideCards';
import type { GuideCard } from './startGuideCards';
import { loadStartGuidePref, saveStartGuidePref } from './startGuideState';

export interface StartGuideProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (dest: Destination) => void;
}

interface ActiveTour {
  card: GuideCard;
  stepIndex: 0 | 1;
}

const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ajn-accent)]';
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Start Guide: Layer A is the goals dialog, Layer B is the step callout. Always mounted by App. */
export function StartGuide({ open, onClose, onNavigate }: StartGuideProps): ReactElement | null {
  const [explaining, setExplaining] = useState<GuideCard | null>(null);
  const [dontAutoOpen, setDontAutoOpen] = useState<boolean>(() => loadStartGuidePref().dontAutoOpen);
  const [tour, setTour] = useState<ActiveTour | null>(null);

  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // Opening: re-read the saved preference, start on the goals view, remember who had focus.
  useEffect(() => {
    if (!open) return;
    setDontAutoOpen(loadStartGuidePref().dontAutoOpen);
    setExplaining(null);
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => { openerRef.current?.focus(); };
  }, [open]);

  // Focus the heading when the dialog opens and whenever the view swaps (goals <-> explain).
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => headingRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open, explaining]);

  // Escape closes; Tab and Shift+Tab stay inside the dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = active instanceof Node && dialogRef.current.contains(active);
      if (e.shiftKey) {
        if (!inside || active === headingRef.current || active === first) { e.preventDefault(); last.focus(); }
      } else if (!inside || active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Escape closes the step callout.
  useEffect(() => {
    if (!tour) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setTour(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tour]);

  const toggleAuto = useCallback((checked: boolean): void => {
    setDontAutoOpen(checked);
    saveStartGuidePref({ version: 1, dontAutoOpen: checked });
  }, []);

  const goTo = useCallback((dest: Destination): void => {
    onNavigate(dest);
    onClose();
  }, [onNavigate, onClose]);

  const startTour = useCallback((card: GuideCard): void => {
    onNavigate(card.dest);
    onClose();
    setTour({ card, stepIndex: 0 });
  }, [onNavigate, onClose]);

  if (typeof document === 'undefined') return null;

  return (
    <>
      {open && createPortal(
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="start-guide-title"
            className="relative max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-neutral-800 bg-neutral-950 p-5 text-neutral-200 shadow-2xl"
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close guide"
              className={`absolute right-4 top-4 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-neutral-400 transition hover:bg-neutral-900 hover:text-white ${RING}`}
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>

            <div className="mb-5 pr-12">
              <span className="font-mono text-xs uppercase tracking-wider text-[var(--ajn-accent)]">Quick Start Guide</span>
              <h1 id="start-guide-title" ref={headingRef} tabIndex={-1} className="mt-1 text-xl font-bold tracking-tight text-white outline-none sm:text-2xl">
                What would you like to do first?
              </h1>
              <p className="mt-1 text-xs text-neutral-400">Choose a goal to begin. You can reopen this guide from the top bar.</p>
            </div>

            {explaining === null ? (
              <>
                <div className="mb-5 grid grid-cols-1 gap-3.5 md:grid-cols-2">
                  {GUIDE_CARDS.map((card) => (
                    <div key={card.id} className="flex flex-col justify-between rounded-xl border border-neutral-800/80 bg-neutral-900/50 p-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-base" aria-hidden="true">{card.emoji}</span>
                          <h2 className="text-sm font-semibold text-white">{card.title}</h2>
                        </div>
                        <p className="mt-1.5 text-xs text-neutral-400">{card.blurb}</p>
                      </div>
                      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-neutral-800 pt-3 text-xs">
                        <button type="button" onClick={() => goTo(card.dest)} className={`min-h-[44px] rounded-lg bg-neutral-800 px-3 py-2 font-medium text-white transition hover:bg-neutral-700 ${RING}`}>
                          {card.openLabel}
                        </button>
                        <span className="select-none text-neutral-600" aria-hidden="true">·</span>
                        <button type="button" onClick={() => startTour(card)} className={`min-h-[44px] rounded-lg px-2 py-2 text-neutral-300 underline decoration-neutral-600 transition hover:text-white hover:decoration-white ${RING}`}>
                          Show me how
                        </button>
                        <span className="select-none text-neutral-600" aria-hidden="true">·</span>
                        <button type="button" onClick={() => setExplaining(card)} className={`min-h-[44px] rounded-lg px-2 py-2 text-neutral-400 transition hover:text-white ${RING}`}>
                          Explain this feature
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mb-5 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3.5 text-xs leading-relaxed text-neutral-300">
                  Radio dock: the radio dock stays with you as you move between pages. Minimise keeps the radio playing. Mute silences it; Pause stops it.
                </div>
              </>
            ) : (
              <div className="mb-5 rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
                <h2 className="text-lg font-semibold text-white">{explaining.explain.title}</h2>
                <p className="mt-2 text-xs leading-relaxed text-neutral-300">{explaining.explain.body}</p>
                <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs">
                  {explaining.explain.pills.map((pill, i) => (
                    <span key={pill} className="flex items-center gap-2">
                      {i > 0 && <span className="font-mono text-neutral-600" aria-hidden="true">→</span>}
                      <span className="rounded border border-neutral-700 bg-neutral-900 px-2.5 py-1 font-medium text-neutral-200">{pill}</span>
                    </span>
                  ))}
                </div>
                <div className="mt-5 flex items-center justify-between gap-3 border-t border-neutral-800 pt-4">
                  <button type="button" onClick={() => setExplaining(null)} className={`min-h-[44px] rounded-lg border border-neutral-700 px-3.5 py-2 text-xs font-medium text-neutral-300 transition hover:bg-neutral-800 hover:text-white ${RING}`}>
                    Back to goals
                  </button>
                  <button type="button" onClick={() => goTo(explaining.dest)} className={`min-h-[44px] rounded-lg bg-[var(--ajn-accent)] px-4 py-2 text-xs font-medium text-white transition hover:opacity-90 ${RING}`}>
                    Take me there
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-col justify-between gap-4 border-t border-neutral-800 pt-4 text-xs sm:flex-row sm:items-center">
              <label className="flex min-h-[44px] cursor-pointer select-none items-center gap-2.5 text-neutral-400">
                <input
                  type="checkbox"
                  checked={dontAutoOpen}
                  onChange={(e) => toggleAuto(e.target.checked)}
                  className="h-4 w-4 rounded border-neutral-700 bg-neutral-900 focus:ring-[var(--ajn-accent)] focus:ring-offset-0"
                />
                <span>Don't open automatically</span>
              </label>
              <button type="button" onClick={onClose} className={`min-h-[44px] rounded-lg bg-neutral-800 px-4 py-2 font-medium text-white transition hover:bg-neutral-700 ${RING}`}>
                Explore on my own
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {tour && createPortal(
        <aside
          role="region"
          aria-label="Guide step"
          className="fixed left-4 right-4 top-20 z-[80] rounded-2xl border border-neutral-800 bg-neutral-950 p-5 text-neutral-200 shadow-2xl sm:left-auto sm:w-full sm:max-w-sm"
        >
          <div className="mb-2 flex items-start justify-between gap-2">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--ajn-accent)]">
              {tour.stepIndex === 0 ? 'Step 1 of 2' : 'Step 2 of 2'}
            </span>
            <button type="button" onClick={() => setTour(null)} aria-label="Close guide step" className={`-mr-2 -mt-2 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-neutral-400 transition hover:text-white ${RING}`}>
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <h2 className="text-sm font-semibold text-white">{tour.card.tour[tour.stepIndex].title}</h2>
          <p className="mt-1 text-xs leading-relaxed text-neutral-300">{tour.card.tour[tour.stepIndex].body}</p>
          <div className="mt-4 flex items-center justify-between border-t border-neutral-800 pt-3 text-xs">
            <div>
              {tour.stepIndex === 1 && (
                <button type="button" onClick={() => setTour((t) => (t ? { ...t, stepIndex: 0 } : null))} className={`min-h-[44px] rounded border border-neutral-800 px-3 py-2 text-neutral-400 transition hover:text-white ${RING}`}>
                  Back
                </button>
              )}
            </div>
            {tour.stepIndex === 0 ? (
              <button type="button" onClick={() => setTour((t) => (t ? { ...t, stepIndex: 1 } : null))} className={`min-h-[44px] rounded bg-neutral-800 px-3.5 py-2 font-medium text-white transition hover:bg-neutral-700 ${RING}`}>
                Next
              </button>
            ) : (
              <button type="button" onClick={() => setTour(null)} className={`min-h-[44px] rounded bg-[var(--ajn-accent)] px-3.5 py-2 font-medium text-white transition hover:opacity-90 ${RING}`}>
                Done
              </button>
            )}
          </div>
        </aside>,
        document.body,
      )}
    </>
  );
}
