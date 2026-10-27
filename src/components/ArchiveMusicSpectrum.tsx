import { useEffect, useRef } from "react";
import { binFrequencies, hasSignal, type AnalyzerState } from "./AudioVisualizerOverlay";

const BAR_COUNT = 72;

interface ArchiveMusicSpectrumProps {
  analyser: AnalyserNode | null | undefined;
  isPlaying: boolean;
  analyzerState: AnalyzerState;
}

/** Reads the existing player analyser. This component creates no Web Audio nodes. */
export function ArchiveMusicSpectrum({ analyser, isPlaying, analyzerState }: ArchiveMusicSpectrumProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
      const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    };
    const drawBaseline = () => {
      resize();
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.strokeStyle = "rgba(103, 232, 249, 0.38)";
      context.lineWidth = Math.max(1, ratio);
      context.beginPath();
      context.moveTo(0, canvas.height - 2 * ratio);
      context.lineTo(canvas.width, canvas.height - 2 * ratio);
      context.stroke();
    };

    const unavailable = !analyser || analyzerState === "unavailable";
    if (unavailable || !isPlaying) {
      drawBaseline();
      return () => context.clearRect(0, 0, canvas.width, canvas.height);
    }

    const bins = new Uint8Array(analyser.frequencyBinCount);
    let frame = 0;
    const draw = () => {
      resize();
      context.clearRect(0, 0, canvas.width, canvas.height);
      analyser.getByteFrequencyData(bins);
      context.strokeStyle = "rgba(103, 232, 249, 0.38)";
      context.lineWidth = Math.max(1, ratio);
      context.beginPath();
      context.moveTo(0, canvas.height - 2 * ratio);
      context.lineTo(canvas.width, canvas.height - 2 * ratio);
      context.stroke();

      if (hasSignal(bins)) {
        const bars = binFrequencies(bins, BAR_COUNT);
        const barWidth = canvas.width / BAR_COUNT;
        const gradient = context.createLinearGradient(0, canvas.height, 0, 0);
        gradient.addColorStop(0, "rgba(34, 211, 238, 0.18)");
        gradient.addColorStop(1, "rgba(103, 232, 249, 0.56)");
        context.fillStyle = gradient;
        for (let index = 0; index < bars.length; index += 1) {
          const height = (bars[index] / 255) * canvas.height * 0.82;
          if (height < 1) continue;
          context.fillRect(index * barWidth, canvas.height - height, Math.max(1, barWidth - ratio), height);
        }
      }
      frame = requestAnimationFrame(draw);
    };

    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(canvas);
    draw();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      context.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [analyser, analyzerState, isPlaying]);

  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" data-testid="archive-music-spectrum">
      <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 h-full w-full opacity-70" />
      {(!analyser || analyzerState === "unavailable") && (
        <span className="absolute bottom-4 left-1/2 z-[1] -translate-x-1/2 rounded-full border border-slate-600 bg-slate-950/90 px-3 py-1.5 text-xs font-medium text-slate-200">
          Spectrum unavailable
        </span>
      )}
    </div>
  );
}
