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
  /** Visual style: "solid" (opacity 0.85) or "transparent" / "semi-transparent" (opacity 0.4). Defaults to "transparent". */
  style?: "solid" | "transparent" | "semi-transparent" | React.CSSProperties;
  variant?: "solid" | "transparent" | "semi-transparent";
  styleVariant?: "solid" | "transparent" | "semi-transparent";
}

/**
 * Semi-transparent canvas drawn from the SAME analyser tap the diagnostics drawer uses.
 * The requestAnimationFrame loop runs only while enabled, the tab is visible and the canvas is on screen;
 * otherwise it is cancelled and the canvas cleared.
 */
export function AudioVisualizerOverlay({ analyser, enabled, mode, style, variant, styleVariant }: OverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [onScreen, setOnScreen] = useState(true);
  const [tabVisible, setTabVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  const [controlsBottom, setControlsBottom] = useState<number | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);

  const isSolid = variant === "solid" || styleVariant === "solid" || style === "solid";
  const customStyle = typeof style === "object" ? style : undefined;
  const targetOpacity = isSolid ? 0.85 : 0.4;

  useEffect(() => {
    if (mode !== "video") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const updateControls = () => {
      const transport =
        parent.querySelector<HTMLElement>('[data-testid="player-transport"]') ||
        document.querySelector<HTMLElement>('[data-testid="player-transport"]');

      if (!transport) {
        setControlsBottom(null);
        return;
      }

      const cs = typeof window !== "undefined" ? window.getComputedStyle(transport) : null;
      const isHidden = Boolean(
        transport.classList.contains("opacity-0") ||
        cs?.opacity === "0" ||
        cs?.display === "none" ||
        cs?.visibility === "hidden"
      );
      setControlsVisible(!isHidden);

      const bottomOffset = cs ? (parseFloat(cs.bottom) || 0) : 0;
      const h = transport.offsetHeight || transport.getBoundingClientRect().height;
      if (h > 0) {
        setControlsBottom(Math.round(h + bottomOffset));
      } else {
        const isSm = typeof window !== "undefined" && window.innerWidth >= 640;
        setControlsBottom(isSm ? 56 + 12 : 80 + 8);
      }
    };

    updateControls();
    const transport =
      parent.querySelector<HTMLElement>('[data-testid="player-transport"]') ||
      document.querySelector<HTMLElement>('[data-testid="player-transport"]');

    let mo: MutationObserver | null = null;
    let ro: ResizeObserver | null = null;

    if (transport && typeof MutationObserver !== "undefined") {
      mo = new MutationObserver(updateControls);
      mo.observe(transport, { attributes: true, attributeFilter: ["class", "style"] });
    }
    if (transport && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(updateControls);
      ro.observe(transport);
      if (parent) ro.observe(parent);
    }

    const onWake = () => requestAnimationFrame(updateControls);
    parent.addEventListener("mousemove", onWake, { passive: true });
    parent.addEventListener("pointerdown", onWake, { passive: true });
    parent.addEventListener("touchstart", onWake, { passive: true });
    parent.addEventListener("keydown", onWake, { passive: true });

    return () => {
      mo?.disconnect();
      ro?.disconnect();
      parent.removeEventListener("mousemove", onWake);
      parent.removeEventListener("pointerdown", onWake);
      parent.removeEventListener("touchstart", onWake);
      parent.removeEventListener("keydown", onWake);
    };
  }, [mode]);

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
    const fit = () => {
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    };
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    ro?.observe(canvas);

    const data = new Uint8Array(analyser.frequencyBinCount);
    const alphaTop = mode === "video" ? (isSolid ? 0.95 : 0.35) : 0.7;
    const alphaBottom = mode === "video" ? (isSolid ? 0.25 : 0.05) : 0.15;
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
  }, [run, analyser, mode, isSolid]);

  const videoOverlayStyle: React.CSSProperties = {
    position: controlsBottom !== null ? "absolute" : "relative",
    left: 0,
    right: 0,
    height: 48,
    bottom: controlsBottom !== null ? controlsBottom : undefined,
    pointerEvents: "none",
    opacity: controlsVisible ? targetOpacity : 0,
    transition: "opacity 300ms ease",
    zIndex: 15,
    ...customStyle,
  };

  return (
    <canvas
      ref={canvasRef}
      data-testid="visualizer-overlay"
      data-running={run ? "1" : "0"}
      data-style={isSolid ? "solid" : "transparent"}
      aria-hidden="true"
      style={mode === "video" ? videoOverlayStyle : customStyle}
      className={`pointer-events-none ${
        mode === "video"
          ? `${controlsBottom !== null ? "absolute inset-x-0" : "relative"} w-full`
          : mode === "audio-briefing"
            ? "absolute inset-x-0 bottom-0 z-[4] h-10 w-full"
            : "absolute inset-0 z-[1] h-full w-full"
      }`}
    />
  );
}
