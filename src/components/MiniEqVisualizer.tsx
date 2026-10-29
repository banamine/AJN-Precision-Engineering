import { useEffect, useRef, useState } from "react";
import { MINI_EQ_BAR_COUNT, miniEqBars, miniEqHue, miniEqMaxHeightFraction } from "../utils/miniEqBars";
import type { AnalyzerState } from "./AudioVisualizerOverlay";

interface MiniEqVisualizerProps {
  /** The SAME analyser the blue background bars read. Read only. */
  analyser: AnalyserNode | null | undefined;
  analyzerState: AnalyzerState;
  isPlaying: boolean;
  enabled: boolean;
  /** true = real artwork is shown (bars overlay it, lower and with a soft vignette); false = icon tile (bars fill it). */
  hasImage: boolean;
}

/**
 * Mini multicolor equalizer that sits on top of the cover-art tile. Creates no Web Audio nodes and uses no synthetic values.
 * Paused = flat stubs. Unreadable analyser = draws nothing (the main spectrum already shows the unavailable label).
 */
export function MiniEqVisualizer({ analyser, analyzerState, isPlaying, enabled, hasImage }: MiniEqVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [onScreen, setOnScreen] = useState(true);
  const [tabVisible, setTabVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  const unavailable = !analyser || analyzerState === "unavailable";
  const run = enabled && isPlaying && !unavailable && onScreen && tabVisible;

  useEffect(() => {
    const el = canvasRef.current;
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
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const fit = () => {
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    };
    const draw = (levels: number[]) => {
      fit();
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const maxFrac = miniEqMaxHeightFraction(hasImage);
      const barW = w / MINI_EQ_BAR_COUNT;
      const pad = Math.max(1, Math.round(1.5 * dpr));
      if (hasImage && levels.some((v) => v > 0)) {
        const vignette = ctx.createLinearGradient(0, h, 0, h * 0.45);
        vignette.addColorStop(0, "rgba(3,7,18,0.65)");
        vignette.addColorStop(1, "rgba(3,7,18,0)");
        ctx.fillStyle = vignette;
        ctx.fillRect(0, h * 0.4, w, h * 0.6);
      }
      for (let i = 0; i < MINI_EQ_BAR_COUNT; i += 1) {
        const barH = Math.max(2 * dpr, (levels[i] / 255) * h * maxFrac);
        const x = i * barW + pad;
        const y = h - barH;
        const bw = Math.max(1, barW - pad * 2);
        const hue = miniEqHue(i);
        const grad = ctx.createLinearGradient(0, h, 0, y);
        if (hasImage) {
          grad.addColorStop(0, `hsla(${hue},95%,45%,0.7)`);
          grad.addColorStop(0.65, `hsla(${hue},100%,60%,0.9)`);
          grad.addColorStop(1, `hsla(${hue + 20},100%,80%,1)`);
        } else {
          grad.addColorStop(0, `hsla(${hue},95%,48%,0.85)`);
          grad.addColorStop(0.55, `hsla(${hue},100%,58%,0.95)`);
          grad.addColorStop(1, `hsla(${hue + 25},100%,75%,1)`);
        }
        ctx.fillStyle = grad;
        ctx.beginPath();
        const r = Math.min(bw / 2, 3 * dpr);
        if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, bw, barH, [r, r, 0, 0]);
        else ctx.rect(x, y, bw, barH);
        ctx.fill();
        if (barH > 6 * dpr) {
          ctx.fillStyle = `hsla(${hue + 30},100%,92%,0.95)`;
          ctx.fillRect(x, y, bw, Math.max(1, 2 * dpr));
        }
      }
    };

    if (!enabled || unavailable) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
    if (!run || !analyser) { draw(new Array(MINI_EQ_BAR_COUNT).fill(0)); return; } // paused: flat stubs
    const bins = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;
    const loop = () => {
      analyser.getByteFrequencyData(bins);
      draw(miniEqBars(bins));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    ro?.observe(canvas);
    return () => { cancelAnimationFrame(raf); ro?.disconnect(); };
  }, [run, enabled, unavailable, analyser, hasImage]);

  if (!enabled) return null;
  return <canvas ref={canvasRef} data-testid="mini-eq" data-running={run ? "1" : "0"} aria-hidden="true" className="pointer-events-none absolute inset-0 z-[1] h-full w-full" />;
}
