// Projection-style auto scroll for the radio briefing: moves the story list at a reading pace with no input needed.
// Auto mode moves the content with a GPU transform (smooth at sub-pixel speeds; scrollTop would step in whole pixels).
// Any touch, wheel, key or focus on the list hands control to the person (normal native scrolling); after a quiet period it resumes.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

export const READING_WPM = 180;        // comfortable on-screen reading speed
export const MIN_SPEED_PX_S = 8;
export const MAX_SPEED_PX_S = 22;
export const START_PAUSE_MS = 4000;    // hold at the top so the first story can be read
export const END_PAUSE_MS = 5000;      // hold at the bottom
export const RETURN_MS = 900;          // eased return to the top
export const IDLE_RESUME_MS = 10000;   // resume after this long without interaction

/** Pixels per second so the whole list takes about as long as reading it, clamped to a calm range. */
export function autoScrollSpeed(words: number, distancePx: number): number {
  if (!(distancePx > 0)) return 0;
  const seconds = Math.max(1, (Math.max(words, 1) / READING_WPM) * 60);
  return Math.min(MAX_SPEED_PX_S, Math.max(MIN_SPEED_PX_S, distancePx / seconds));
}

export type AutoScrollPhase = "start-pause" | "scrolling" | "end-pause" | "returning";
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export interface AutoScroll {
  /** User or reduced-motion pause (button). */
  paused: boolean;
  setPaused: (v: boolean) => void;
  /** True while the person has taken over by touching/scrolling; auto resumes by itself. */
  manual: boolean;
  reducedMotion: boolean;
  /** Spread onto the scroll container. */
  containerProps: {
    onPointerDown: () => void; onWheel: () => void; onTouchStart: () => void; onKeyDown: () => void; onFocus: () => void; onScroll: () => void;
  };
}

export function useAutoScroll(
  containerRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  opts: { enabled: boolean; contentKey: unknown },
): AutoScroll {
  const reducedMotion = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [paused, setPaused] = useState(reducedMotion); // reduced motion starts off; the button can turn it on
  const [manual, setManual] = useState(false);
  const pos = useRef(0);
  const idleTimer = useRef<number | null>(null);
  const settingScroll = useRef(false);

  const clearIdle = () => { if (idleTimer.current !== null) { window.clearTimeout(idleTimer.current); idleTimer.current = null; } };
  const armIdle = useCallback(() => {
    clearIdle();
    idleTimer.current = window.setTimeout(() => setManual(false), IDLE_RESUME_MS);
  }, []);
  const takeOver = useCallback(() => { setManual(true); armIdle(); }, [armIdle]);

  // Hand position back and forth between transform (auto) and scrollTop (manual) without a visible jump.
  useLayoutEffect(() => {
    const box = containerRef.current, inner = contentRef.current;
    if (!box || !inner) return;
    settingScroll.current = true;
    if (manual) { inner.style.transform = ""; box.scrollTop = pos.current; }
    else { pos.current = box.scrollTop || pos.current; box.scrollTop = 0; inner.style.transform = `translate3d(0,${-pos.current}px,0)`; }
    const t = window.setTimeout(() => { settingScroll.current = false; }, 0);
    return () => window.clearTimeout(t);
  }, [manual, containerRef, contentRef]);

  useEffect(() => () => clearIdle(), []);

  useEffect(() => {
    const box = containerRef.current, inner = contentRef.current;
    if (!opts.enabled || paused || manual || !box || !inner) return;
    let raf = 0, last = performance.now(), phase: AutoScrollPhase = pos.current > 1 ? "scrolling" : "start-pause", phaseStart = last, from = 0, alive = true;
    let max = 0, speed = 0;
    const measure = () => {
      max = Math.max(0, inner.scrollHeight - box.clientHeight);
      const words = (inner.textContent ?? "").trim().split(/\s+/).filter(Boolean).length;
      speed = autoScrollSpeed(words, max);
      if (pos.current > max) pos.current = max;
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(box); ro?.observe(inner);
    const apply = () => { inner.style.transform = `translate3d(0,${-pos.current}px,0)`; };
    const tick = (now: number) => {
      if (!alive) return;
      const dt = Math.min(100, now - last); last = now;
      if (max > 0 && speed > 0) {
        if (phase === "start-pause") { if (now - phaseStart >= START_PAUSE_MS) { phase = "scrolling"; } }
        else if (phase === "scrolling") {
          pos.current = Math.min(max, pos.current + (speed * dt) / 1000);
          if (pos.current >= max) { phase = "end-pause"; phaseStart = now; }
        } else if (phase === "end-pause") { if (now - phaseStart >= END_PAUSE_MS) { phase = "returning"; phaseStart = now; from = pos.current; } }
        else { const t = Math.min(1, (now - phaseStart) / RETURN_MS); pos.current = from * (1 - easeInOut(t)); if (t >= 1) { phase = "start-pause"; phaseStart = now; pos.current = 0; } }
        apply();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { alive = false; cancelAnimationFrame(raf); ro?.disconnect(); };
  }, [opts.enabled, opts.contentKey, paused, manual, containerRef, contentRef]);

  return {
    paused, setPaused, manual, reducedMotion,
    containerProps: {
      onPointerDown: takeOver, onWheel: takeOver, onTouchStart: takeOver, onKeyDown: takeOver, onFocus: takeOver,
      onScroll: () => { if (manual && !settingScroll.current) { pos.current = containerRef.current?.scrollTop ?? pos.current; armIdle(); } },
    },
  };
}
