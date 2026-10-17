import { useEffect, useRef, useState } from "react";

export const OVERLAY_BAR_COUNT = 120;
const SIGNAL_POLL_MS = 250;

/** Collapse the analyser's frequency bins into `count` bars (peak per group). Pure; exported for tests. */
export function binFrequencies(data: ArrayLike<number>, count: number): number[] {
  const out: number[] = new Array(count).fill(0);
  if (!data.length) return out;
  for (let bar = 0; bar < count; bar += 1) {
    const start = Math.floor((bar / count) * data.length);
    const end = Math.max(start + 1, Math.floor(((bar + 1) / count) * data.length));
    let v = 0;
    for (let i = start; i < end && i < data.length; i += 1) v = Math.max(v, data[i]);
    out[bar] = v;
  }
  return out;
}

export function hasSignal(data: ArrayLike<number>): boolean {
  let peak = 0;
  let total = 0;
  for (let i = 0; i < data.length; i += 1) { peak = Math.max(peak, data[i]); total += data[i]; }
  return data.length > 0 && (peak > 8 || total / data.length > 3);
}

export type AnalyzerState = "active" | "idle" | "unavailable";

/**
 * Cheap 4 Hz read of the existing diagnostics analyser so the toolbar pill is truthful even when
 * the diagnostics drawer and the overlay are both off. Never creates audio nodes; only reads.
 */
export function useAnalyzerState(analyser: AnalyserNode | null | undefined, isPlaying: boolean): AnalyzerState {
  const [state, setState] = useState<AnalyzerState>(analyser ? "idle" : "unavailable");
  useEffect(() => {
    if (!analyser) { setState("unavailable"); return; }
    if (!isPlaying) { setState("idle"); return; }
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      setState(hasSignal(data) ? "active" : "idle");
    };
    tick();
    const id = window.setInterval(tick, SIGNAL_POLL_MS);
    return () => window.clearInterval(id);
  }, [analyser, isPlaying]);
  return state;
}

interface OverlayProps {
  analyser: AnalyserNode | null | undefined;
  /** Player is playing and visualization is enabled; briefing mode pins it on. */
  enabled: boolean;
  /** Video: subdued strip; audio: ambient fill; Live Radio briefing: reserved bottom strip. */
  mode: "video" | "audio" | "audio-briefing";
}

/**
 * Semi-transparent canvas drawn from the SAME analyser tap the diagnostics drawer uses.
 * The requestAnimationFrame loop runs only while enabled, the tab is visible and the canvas is on screen;
 * otherwise it is cancelled and the canvas cleared.
 */
export function AudioVisualizerOverlay({ analyser, enabled, mode }: OverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [onScreen, setOnScreen] = useState(true);
  const [tabVisible, setTabVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");

  useEffect(() => {
    const el = canvasRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => setOnScreen(entries.some((e) => e.isIntersecting)));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const on = () => setTabVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);

  const run = enabled && onScreen && tabVisible && Boolean(analyser);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const clear = () => ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!run || !analyser) { clear(); return; }

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const fitTo = (cssW: number, cssH: number) => {
      const w = Math.max(1, Math.round(cssW * dpr));
      const h = Math.max(1, Math.round(cssH * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    };
    // ResizeObserver supplies the size (no layout read); read directly only when it is unavailable.
    const fit = (entries?: ResizeObserverEntry[]) => {
      const box = entries?.[entries.length - 1]?.contentRect;
      if (box) fitTo(box.width, box.height); else fitTo(canvas.clientWidth, canvas.clientHeight);
    };
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(entries => fit(entries)) : null;
    if (!ro) fit();
    ro?.observe(canvas);

    const data = new Uint8Array(analyser.frequencyBinCount);
    const alphaTop = mode === "video" ? 0.35 : 0.7;
    const alphaBottom = mode === "video" ? 0.05 : 0.15;
    let raf = 0;
    const draw = () => {
      analyser.getByteFrequencyData(data);
      const bars = binFrequencies(data, OVERLAY_BAR_COUNT);
      clear();
      const grad = ctx.createLinearGradient(0, canvas.height, 0, 0);
      grad.addColorStop(0, `rgba(14,165,233,${alphaBottom})`);
      grad.addColorStop(1, `rgba(56,189,248,${alphaTop})`);
      ctx.fillStyle = grad;
      const bw = canvas.width / OVERLAY_BAR_COUNT;
      for (let i = 0; i < OVERLAY_BAR_COUNT; i += 1) {
        const hgt = Math.max(1, (bars[i] / 255) * canvas.height);
        ctx.fillRect(i * bw + 0.5, canvas.height - hgt, Math.max(1, bw - 1), hgt);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro?.disconnect(); clear(); };
  }, [run, analyser, mode]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="visualizer-overlay"
      data-running={run ? "1" : "0"}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-x-0 w-full ${
        // video: a strip that sits ABOVE the floating transport; audio: fills its own stage, behind the album art (z-1 < art z-2 < controls z-10)
        mode === "video"
          ? "bottom-[6.5rem] z-10 h-10 sm:bottom-[4.5rem]"
          : mode === "audio-briefing"
            ? "bottom-0 z-[4] h-10"
            : "inset-0 z-[1] h-full"
      }`}
    />
  );
}
