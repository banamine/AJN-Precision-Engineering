import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { ChevronUp } from "lucide-react";

/** Flyouts along the bottom of the full player: same behaviour as the header's "More" menu (hover opens after a short wait, a click holds it open,
 *  Escape or a click elsewhere closes it), but the panel opens upward over the player so the page never grows taller than the screen. */
export interface DockItem { key: string; label: string; content: ReactNode }

const OPEN_MS = 100; const CLOSE_MS = 250;
const canHover = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;

export function PlayerDock({ items }: { items: readonly DockItem[] }): ReactElement | null {
  const [open, setOpen] = useState<string | null>(null);
  const openRef = useRef<string | null>(null);
  const pinned = useRef(false);
  const openT = useRef<number | null>(null); const closeT = useRef<number | null>(null);
  const clear = useCallback(() => { if (openT.current !== null) { window.clearTimeout(openT.current); openT.current = null; } if (closeT.current !== null) { window.clearTimeout(closeT.current); closeT.current = null; } }, []);
  const set = useCallback((k: string | null) => { openRef.current = k; setOpen(k); }, []);
  const closeNow = useCallback(() => { clear(); pinned.current = false; set(null); }, [clear, set]);
  useEffect(() => clear, [clear]);

  const enter = (k: string, e: React.PointerEvent) => {
    if (e.pointerType === "touch" || !canHover()) return;
    if (closeT.current !== null) { window.clearTimeout(closeT.current); closeT.current = null; }
    if (openRef.current === k) return;
    if (openT.current !== null) window.clearTimeout(openT.current);
    if (openRef.current !== null) { pinned.current = false; set(k); return; }
    openT.current = window.setTimeout(() => { openT.current = null; pinned.current = false; set(k); }, OPEN_MS);
  };
  const leave = (e: React.PointerEvent) => {
    if (e.pointerType === "touch" || !canHover()) return;
    if (openT.current !== null) { window.clearTimeout(openT.current); openT.current = null; }
    if (openRef.current === null || pinned.current) return;
    if (closeT.current !== null) window.clearTimeout(closeT.current);
    closeT.current = window.setTimeout(() => { closeT.current = null; set(null); }, CLOSE_MS);
  };
  const click = (k: string, e: React.MouseEvent) => {
    clear();
    if (openRef.current === k) { if (e.detail !== 0 && !pinned.current) { pinned.current = true; return; } closeNow(); return; }
    pinned.current = true; set(k);
  };

  useEffect(() => {
    if (open === null) return;
    const down = (e: MouseEvent) => { const t = e.target; if (!(t instanceof Element) || !t.closest("[data-dock-flyout]")) closeNow(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") closeNow(); };
    document.addEventListener("mousedown", down); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open, closeNow]);

  if (!items.length) return null;
  return (
    <div data-testid="player-dock" className="relative z-20 flex flex-wrap items-center gap-2">
      {items.map((it) => {
        const isOpen = open === it.key;
        return (
          <div key={it.key} data-dock-flyout={it.key} className="relative" onPointerEnter={(e) => enter(it.key, e)} onPointerLeave={leave}>
            <button type="button" data-testid={`dock-${it.key}`} aria-expanded={isOpen} aria-controls={`dock-panel-${it.key}`} onClick={(e) => click(it.key, e)}
              className={`flex min-h-[40px] items-center gap-2 rounded-lg border px-3 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${isOpen ? "border-[var(--ajn-accent,#E06D3B)] bg-neutral-900 text-white" : "border-neutral-700 bg-neutral-950 text-neutral-200 hover:bg-neutral-900"}`}>
              {it.label}
              <ChevronUp className={`h-3.5 w-3.5 transition-transform ${isOpen ? "" : "rotate-180"}`} />
            </button>
            {isOpen && (
              <div className="absolute bottom-full left-0 z-50 w-[min(40rem,calc(100vw-1.5rem))] pb-2">
                <div id={`dock-panel-${it.key}`} role="region" aria-label={it.label} data-testid={`dock-panel-${it.key}`}
                  className="max-h-[min(60vh,30rem)] overflow-y-auto overscroll-contain rounded-xl border border-neutral-800 bg-neutral-950/95 p-3 shadow-2xl backdrop-blur-md">
                  {it.content}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
