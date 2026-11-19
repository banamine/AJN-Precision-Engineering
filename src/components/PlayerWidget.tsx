import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/** Breakpoint class used for the Full player page (matches the locked shell spec: <768, 768-1023, >=1024). */
export type BpClass = "narrow" | "medium" | "wide";

function bpOf(width: number): BpClass {
  return width >= 1024 ? "wide" : width >= 768 ? "medium" : "narrow";
}

export function useBpClass(): BpClass {
  const [bp, setBp] = useState<BpClass>(() => (typeof window === "undefined" ? "wide" : bpOf(window.innerWidth)));
  useEffect(() => {
    const on = () => setBp(bpOf(window.innerWidth));
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return bp;
}

const memKey = (bp: BpClass, tab: string, widget: string) => `ajn.widget.v1:${bp}:${tab}:${widget}`;
function readMem(k: string): boolean | null {
  try { const v = window.localStorage.getItem(k); return v === "1" ? true : v === "0" ? false : null; } catch { return null; }
}
function writeMem(k: string, open: boolean) {
  try { window.localStorage.setItem(k, open ? "1" : "0"); } catch { /* remembered for this visit only */ }
}

export interface WidgetSpec {
  key: string;
  title: string;
  /** Open by default on wide screens / on narrow+medium screens. */
  defaultOpenWide?: boolean;
  defaultOpenNarrow?: boolean;
  content: ReactNode;
  /** Extra classes on the widget card (e.g. grid spans on wide screens). */
  className?: string;
}

interface Props {
  tab: string;
  widgets: readonly WidgetSpec[];
}

/** Shared collapsible widget stack. State is remembered per widget AND per breakpoint class;
 *  below 1024px it behaves as an accordion (one open at a time). */
export function PlayerWidgets({ tab, widgets }: Props) {
  const bp = useBpClass();
  const accordion = bp !== "wide";
  const baseId = useId();
  const defaults = useMemo(() => {
    const d: Record<string, boolean> = {};
    for (const w of widgets) d[w.key] = bp === "wide" ? !!w.defaultOpenWide : !!w.defaultOpenNarrow;
    return d;
  }, [widgets, bp]);
  const compute = useCallback(() => {
    const o: Record<string, boolean> = {};
    for (const w of widgets) { const m = readMem(memKey(bp, tab, w.key)); o[w.key] = m ?? defaults[w.key]; }
    if (accordion) { // keep only the first open widget
      let seen = false;
      for (const w of widgets) { if (o[w.key]) { if (seen) o[w.key] = false; seen = true; } }
    }
    return o;
  }, [widgets, bp, tab, defaults, accordion]);
  const [open, setOpen] = useState<Record<string, boolean>>(compute);
  // Defaults restore on a breakpoint change unless the user changed that widget at that breakpoint.
  useEffect(() => { setOpen(compute()); }, [bp]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (key: string) => {
    setOpen((cur) => {
      const next = { ...cur, [key]: !cur[key] };
      if (accordion && next[key]) for (const w of widgets) if (w.key !== key) { next[w.key] = false; writeMem(memKey(bp, tab, w.key), false); }
      writeMem(memKey(bp, tab, key), next[key]);
      return next;
    });
  };

  return (
    <>
      {widgets.map((w) => {
        const isOpen = !!open[w.key];
        const hid = `${baseId}-${w.key}-h`;
        const bid = `${baseId}-${w.key}-b`;
        return (
          <section key={w.key} data-testid={`widget-${w.key}`} className={`widget-card mb-3 min-w-0 shrink-0 break-inside-avoid overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/50 ${w.className ?? ""}`}>
            <h2 className="m-0">
              <button type="button" id={hid} aria-expanded={isOpen} aria-controls={bid} onClick={() => toggle(w.key)}
                className="widget-header flex w-full items-center justify-between gap-2 px-3 text-left text-sm font-semibold text-neutral-100">
                <span className="truncate">{w.title}</span>
                <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden="true" />
              </button>
            </h2>
            <div id={bid} role="region" aria-labelledby={hid} hidden={!isOpen} className="space-y-3 p-3 pt-0">
              {w.content}
            </div>
          </section>
        );
      })}
    </>
  );
}
