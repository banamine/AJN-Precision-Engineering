import { useEffect, useRef, useState } from "react";
import { HEATMAP_ROWS, binToRows, buildHeatmapLut } from "../utils/heatmapColor";
import type { AnalyzerState } from "./AudioVisualizerOverlay";

/** Columns scrolled per second, independent of display refresh rate. */
const SCROLL_PX_PER_SEC = 60;
const LUT = buildHeatmapLut();

interface HeatmapStripProps {
  /** The EXISTING pre-gain analyser (fftSize 2048). Read only: never change its settings. */
  analyser: AnalyserNode | null | undefined;
  analyzerState: AnalyzerState;
  isPlaying: boolean;
  enabled: boolean;
  /** Changes when the track changes; the strip is cleared so one song's picture never carries into the next. */
  resetKey: string;
}

/**
 * Small rolling spectrogram strip for archive-music mode. Reads frequency data from the existing analyser;
 * creates no Web Audio nodes and uses no synthetic values. Paused = stops drawing (last picture stays).
 * Unreadable analyser = truthful "unavailable" label, never fake data.
 */
export function HeatmapStrip({ analyser, analyzerState, isPlaying, enabled, resetKey }: HeatmapStripProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = useState(true);
  const [tabVisible, setTabVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");

  const unavailable = !analyser || analyzerState === "unavailable";
  const run = enabled && isPlaying && !unavailable && onScreen && tabVisible;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => setOnScreen(entries.some((e) => e.isIntersecting)));
    io.observe(el);
    return () => io.disconnect();
  }, [enabled]);

  useEffect(() => {
    const on = () => setTabVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  }, [resetKey, enabled, unavailable]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !run || !analyser) return;

    const fit = () => {
      const w = Math.max(1, Math.round(canvas.clientWidth));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== HEATMAP_ROWS) canvas.height = HEATMAP_ROWS;
    };
    fit();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    ro?.observe(canvas);

    const bins = new Uint8Array(analyser.frequencyBinCount);
    const column = ctx.createImageData(1, HEATMAP_ROWS);
    const sampleRate = analyser.context.sampleRate;
    const fftSize = analyser.fftSize;
    let raf = 0;
    let last = performance.now();
    let carry = 0;

    const draw = (now: number) => {
      carry += Math.min(0.1, (now - last) / 1000) * SCROLL_PX_PER_SEC;
      last = now;
      const n = Math.floor(carry);
      if (n > 0) {
        carry -= n;
        analyser.getByteFrequencyData(bins);
        const rows = binToRows(bins, HEATMAP_ROWS, sampleRate, fftSize);
        for (let r = 0; r < HEATMAP_ROWS; r += 1) {
          const o = (HEATMAP_ROWS - 1 - r) * 4; // low frequencies at the bottom
          const l = rows[r] * 4;
          column.data[o] = LUT[l];
          column.data[o + 1] = LUT[l + 1];
          column.data[o + 2] = LUT[l + 2];
          column.data[o + 3] = LUT[l + 3];
        }
        const w = canvas.width;
        const shift = Math.min(n, w);
        ctx.globalCompositeOperation = "copy";
        ctx.drawImage(canvas, -shift, 0);
        ctx.globalCompositeOperation = "source-over";
        for (let k = 0; k < shift; k += 1) ctx.putImageData(column, w - shift + k, 0);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [run, analyser]);

  if (!enabled) return null;
  return (
    <div
      ref={wrapRef}
      data-testid="archive-heatmap"
      data-running={run ? "1" : "0"}
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] hidden h-[72px] sm:block"
      style={{ WebkitMaskImage: "linear-gradient(to top, #000 70%, transparent)", maskImage: "linear-gradient(to top, #000 70%, transparent)" }}
    >
      <canvas ref={canvasRef} className="h-full w-full" />
      {unavailable && (
        <span className="absolute bottom-1 right-2 text-[10px] font-medium text-slate-300">Heat-map unavailable</span>
      )}
    </div>
  );
}
