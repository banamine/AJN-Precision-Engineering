import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ROTATION_MS, MAX_LOAD_ATTEMPTS, ID_RE, canGoBack, commitShown, currentOf, emptyHistory, formatDateLine, imageUrl,
  pickCandidate, stepBack, stepForward, canGoForwardInHistory, zoomIn, zoomOut, type ReelHistory,
} from "./reelLogic";

type CatalogState = { kind: "loading" } | { kind: "ready"; ids: string[] } | { kind: "empty" } | { kind: "unavailable" };
type Fit = "page" | "width" | number; // number = percent of the capture's own width

/** Resolves true only when the image has really loaded and decoded; the caller then commits image + caption together. */
function loadCapture(id: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { (typeof img.decode === "function" ? img.decode().catch(() => undefined) : Promise.resolve()).then(() => resolve(true)); };
    img.onerror = () => resolve(false);
    img.src = imageUrl(id);
  });
}

function useDeviceReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** True when the window is wide enough (768px+) to hold the preview inside the stage, beside the round picture. */
export function useWideStage(): boolean {
  const q = "(min-width: 768px)";
  const [wide, setWide] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(q).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(q);
    if (!mq) return;
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

export interface HomepageReelProps { isPlaying: boolean; onPlay: () => void; onPause: () => void; /** Small card for inside the stage (desktop/tablet). */ compact?: boolean }

/** Quiet rotating preview of historical homepage captures under the audio, with a click-to-open full-screen viewer.
 *  Not synchronized to the audio. The viewer's only audio control is one Play/Pause button wired to the player. */
export default function HomepageReel({ isPlaying, onPlay, onPause, compact = false }: HomepageReelProps) {
  const reduced = useDeviceReducedMotion();
  const [catalog, setCatalog] = useState<CatalogState>({ kind: "loading" });
  const [history, setHistory] = useState<ReelHistory>(emptyHistory);
  const historyRef = useRef(history); historyRef.current = history;
  const [view, setView] = useState<{ layers: [string | null, string | null]; active: 0 | 1 }>({ layers: [null, null], active: 0 });
  const { layers, active } = view;
  const [loadFailed, setLoadFailed] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.hidden);
  const [viewerOpen, setViewerOpen] = useState(false);
  const token = useRef(0);           // bumping this invalidates any capture still loading
  const idsRef = useRef<string[]>([]);
  const previewRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/library/homepages", { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { ids?: unknown }) => {
        const ids = Array.isArray(d.ids) ? d.ids.filter((x): x is string => typeof x === "string" && ID_RE.test(x)) : [];
        idsRef.current = ids;
        setCatalog(ids.length ? { kind: "ready", ids } : { kind: "empty" });
      })
      .catch((e) => { if (!ac.signal.aborted) setCatalog({ kind: "unavailable" }); void e; });
    return () => { ac.abort(); token.current += 1; };
  }, []);

  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);

  const show = useCallback((id: string, nextHistory: (h: ReelHistory) => ReelHistory) => {
    // Image and caption change together, on the hidden layer, which then fades in.
    setView((v) => { const back = (v.active === 0 ? 1 : 0) as 0 | 1; const layers: [string | null, string | null] = [v.layers[0], v.layers[1]]; layers[back] = id; return { layers, active: back }; });
    setHistory(nextHistory);
    setLoadFailed(false);
  }, []);

  /** Fetches a NEW random capture. Failed candidates never enter history; after a few failures the slideshow pauses and the last good capture stays. */
  const loadNew = useCallback(async (): Promise<boolean> => {
    const my = ++token.current;
    const failed = new Set<string>();
    for (let attempt = 0; attempt < MAX_LOAD_ATTEMPTS; attempt += 1) {
      const id = pickCandidate(idsRef.current, currentOf(historyRef.current), failed);
      if (!id) break;
      const ok = await loadCapture(id);
      if (token.current !== my) return false;      // paused, opened, or unmounted meanwhile
      if (ok) { show(id, (h) => commitShown(h, id)); return true; }
      failed.add(id);
    }
    setLoadFailed(true);
    setUserPaused(true);
    return false;
  }, [show]);

  useEffect(() => { if (catalog.kind === "ready" && !currentOf(historyRef.current) && !loadFailed) void loadNew(); }, [catalog, loadNew, loadFailed]);

  const suspended = userPaused || hover || focus || hidden || viewerOpen || reduced || catalog.kind !== "ready" || !currentOf(history);
  useEffect(() => {
    if (suspended) return;
    const t = window.setTimeout(() => { void loadNew(); }, ROTATION_MS);   // one timer; resuming always waits a full interval, no catch-up
    return () => window.clearTimeout(t);
  }, [suspended, history, loadNew]);

  const goPrev = () => { token.current += 1; setUserPaused(true); const h = stepBack(historyRef.current); const id = currentOf(h); if (id) show(id, stepBack); };
  const goNext = () => {
    token.current += 1; setUserPaused(true);
    if (canGoForwardInHistory(historyRef.current)) { const h = stepForward(historyRef.current); const id = currentOf(h); if (id) show(id, stepForward); return; }
    void loadNew();
  };
  const toggleSlideshow = () => { token.current += userPaused ? 0 : 1; setLoadFailed(false); setUserPaused((p) => !p); };
  const openViewer = () => { token.current += 1; setUserPaused(true); setViewerOpen(true); };
  const closeViewer = () => { setViewerOpen(false); window.setTimeout(() => previewRef.current?.focus(), 0); };

  if (catalog.kind === "loading" || catalog.kind === "empty") return null;
  const shown = layers[active];
  const dateLine = shown ? formatDateLine(shown) : null;
  const canPrev = canGoBack(history);
  const fade = reduced ? "" : "transition-opacity duration-300 motion-reduce:transition-none";

  const mini = "flex h-7 min-w-7 items-center justify-center rounded border border-white/25 px-1.5 text-[11px] text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:opacity-40";
  // Compact card: as wide as the stage allows without touching the round picture (46vw - 205px is the room beside the circle) and never taller than the stage.
  const rootClass = compact ? "pointer-events-auto [--cap:24rem]" : "mx-auto mt-3 w-full max-w-md px-3 sm:max-w-lg";
  const previewClass = `relative block aspect-[4/3] w-full overflow-hidden rounded-lg bg-slate-900 ring-1 ring-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400`;
  const layersView = (
    <>
      {([0, 1] as const).map((i) => layers[i] && (
        <img key={i} src={imageUrl(layers[i] as string)} alt="" aria-hidden="true" draggable={false}
          className={`absolute inset-0 h-full w-full object-cover object-top ${fade} ${active === i ? "opacity-100" : "opacity-0"}`} />
      ))}
      {!shown && <span className="absolute inset-0 animate-pulse bg-slate-800 motion-reduce:animate-none" aria-hidden="true" />}
    </>
  );

  return (
    <section aria-label="Library capture of a historical homepage" data-testid="library-reel" className={rootClass} style={compact ? { width: "max(8rem, min(var(--cap), calc(46vw - 205px), calc((58vh - 6.5rem) * 1.333)))" } : undefined}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false); }}>
      <div className={`mb-1 flex items-center justify-between font-bold uppercase tracking-[0.2em] text-slate-300 ${compact ? "text-[9px]" : "text-[10px]"}`}>
        <span>Library capture</span>
        <button type="button" onClick={openViewer} disabled={!shown} className="rounded px-2 py-1 text-[11px] normal-case tracking-normal text-sky-200 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:opacity-40">Expand</button>
      </div>
      <button ref={previewRef} type="button" onClick={openViewer} disabled={!shown} aria-label={dateLine ? `Open historical homepage from ${dateLine}` : "Historical homepage loading"} className={previewClass}>
        {layersView}
      </button>
      <p data-testid="library-reel-date" className={`mt-1 font-medium text-slate-200 ${compact ? "text-[10px] leading-tight" : "text-xs"}`}>{dateLine ?? "\u00a0"}</p>
      <p className={`text-slate-400 ${compact ? "text-[9px] leading-tight" : "text-[11px]"}`}>Historical homepage. Not synchronized to this audio.</p>
      {(loadFailed || catalog.kind === "unavailable") && <p role="status" className={`text-amber-300 ${compact ? "text-[10px]" : "text-[11px]"}`}>Library temporarily unavailable</p>}
      {compact ? (
        <div className="mt-1 flex items-center gap-1">
          <button type="button" onClick={goPrev} disabled={!canPrev} aria-label="Previous" title="Previous" className={mini}>◀</button>
          {!reduced && <button type="button" onClick={toggleSlideshow} aria-label={userPaused ? "Play slideshow" : "Pause slideshow"} title={userPaused ? "Play slideshow" : "Pause slideshow"} className={mini}>{userPaused ? "▶ Play" : "❚❚ Pause"}</button>}
          <button type="button" onClick={goNext} disabled={!shown} aria-label="Next" title="Next" className={mini}>▶</button>
        </div>
      ) : (
        <div className="mt-1 flex items-center gap-2 text-xs">
          <button type="button" onClick={goPrev} disabled={!canPrev} className="rounded border border-white/25 px-3 py-1.5 text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:opacity-40">Previous</button>
          {!reduced && <button type="button" onClick={toggleSlideshow} className="rounded border border-white/25 px-3 py-1.5 text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">{userPaused ? "Play slideshow" : "Pause slideshow"}</button>}
          <button type="button" onClick={goNext} disabled={!shown} className="rounded border border-white/25 px-3 py-1.5 text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:opacity-40">Next</button>
        </div>
      )}
      {viewerOpen && shown && <Viewer id={shown} dateLine={dateLine} isPlaying={isPlaying} onPlay={onPlay} onPause={onPause}
        canPrev={canPrev} onPrev={goPrev} onNext={goNext} onClose={closeViewer} />}
    </section>
  );
}

interface ViewerProps { id: string; dateLine: string | null; isPlaying: boolean; onPlay: () => void; onPause: () => void; canPrev: boolean; onPrev: () => void; onNext: () => void; onClose: () => void }

function Viewer({ id, dateLine, isPlaying, onPlay, onPause, canPrev, onPrev, onNext, onClose }: ViewerProps) {
  const [fit, setFit] = useState<Fit>("page");
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); const prev = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = prev; }; }, []);
  useEffect(() => { setNatural(null); setFailed(false); }, [id]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    if (e.key !== "Tab") return;
    const nodes = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]');
    if (!nodes || nodes.length === 0) return;
    const first = nodes[0]; const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const pct = typeof fit === "number" ? fit : null;
  const imgStyle: React.CSSProperties = fit === "page" ? { maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }
    : fit === "width" ? { width: "100%", height: "auto" }
    : natural ? { width: `${(natural.w * (pct as number)) / 100}px`, maxWidth: "none", height: "auto" } : { maxWidth: "100%" };
  const btn = "rounded border border-white/25 px-3 py-1.5 text-sm text-slate-100 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:opacity-40";

  return createPortal(
    <div data-ajn-modal role="dialog" aria-modal="true" aria-label="Historical homepage viewer" ref={dialogRef} onKeyDown={onKeyDown}
      className="fixed inset-0 z-[200] flex flex-col bg-black/95 text-slate-100">
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Library capture</p><p className="truncate text-sm font-medium">{dateLine}</p></div>
        <button ref={closeRef} type="button" onClick={onClose} className={btn}>Close</button>
      </header>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-2" role="toolbar" aria-label="Viewer controls">
        <button type="button" className={btn} onClick={onPrev} disabled={!canPrev}>Previous</button>
        <button type="button" className={btn} onClick={onNext}>Next</button>
        <span className="mx-1 h-5 w-px bg-white/20" aria-hidden="true" />
        <button type="button" className={btn} aria-pressed={fit === "page"} onClick={() => setFit("page")}>Fit page</button>
        <button type="button" className={btn} aria-pressed={fit === "width"} onClick={() => setFit("width")}>Fit width</button>
        <button type="button" className={btn} aria-pressed={fit === 100} onClick={() => setFit(100)}>100%</button>
        <button type="button" className={btn} aria-label="Zoom out" onClick={() => setFit((f) => zoomOut(typeof f === "number" ? f : 100))}>−</button>
        <button type="button" className={btn} aria-label="Zoom in" onClick={() => setFit((f) => zoomIn(typeof f === "number" ? f : 100))}>+</button>
        <span className="text-xs text-slate-300" aria-live="polite">{fit === "page" ? "Fit page" : fit === "width" ? "Fit width" : `${fit}%`}</span>
      </div>
      <div tabIndex={0} aria-label="Homepage capture, scrollable" className="relative min-h-0 flex-1 overflow-auto px-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
        <div className={fit === "page" ? "flex h-full w-full items-center justify-center" : "mx-auto w-fit"}>
          {failed
            ? <p role="status" className="text-sm text-amber-300">Library temporarily unavailable</p>
            : <img src={imageUrl(id)} alt={dateLine ? `Historical homepage captured ${dateLine}` : "Historical homepage"} style={imgStyle} draggable={false}
                onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} onError={() => setFailed(true)} />}
        </div>
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <button type="button" className={btn} onClick={() => (isPlaying ? onPause() : onPlay())}>{isPlaying ? "Pause audio" : "Play audio"}</button>
        <p className="text-xs text-slate-400">Historical homepage. Not synchronized to this audio.</p>
      </footer>
    </div>,
    document.body,
  );
}
