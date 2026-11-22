/* Real spectrum for the On Air music view. Bars come only from analyser.getByteFrequencyData (no Math.random, no canned animation).
 * If the browser cannot read the stream, or the stream carries no signal, it says so instead of drawing movement. */
import { useEffect, useRef, useState } from 'react';
import { binFrequencies, hasSignal } from '../components/AudioVisualizerOverlay';

const BARS = 48;
const NO_SIGNAL_AFTER_MS = 5000;
export type MeterState = 'idle' | 'reading' | 'unavailable';

export default function OnAirSpectrum({ analyser, state, playing }: { analyser: AnalyserNode | null; state: MeterState; playing: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [silent, setSilent] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current; const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return undefined;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const size = (): void => {
      const w = Math.max(1, Math.round(canvas.clientWidth * ratio)), h = Math.max(1, Math.round(canvas.clientHeight * ratio));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    };
    const baseline = (): void => {
      size(); ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(243, 193, 90, 0.35)'; ctx.fillRect(0, canvas.height - 2 * ratio, canvas.width, 2 * ratio);
    };
    if (!analyser || state !== 'reading' || !playing) { baseline(); setSilent(false); return undefined; }
    const bins = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0; let lastSignalAt = performance.now(); let wasSilent = false;
    const draw = (): void => {
      size(); ctx.clearRect(0, 0, canvas.width, canvas.height);
      analyser.getByteFrequencyData(bins);
      const live = hasSignal(bins);
      const now = performance.now();
      if (live) lastSignalAt = now;
      const nowSilent = now - lastSignalAt > NO_SIGNAL_AFTER_MS;
      if (nowSilent !== wasSilent) { wasSilent = nowSilent; setSilent(nowSilent); }
      const levels = binFrequencies(bins, BARS);
      const gap = Math.max(2, Math.round(canvas.width / BARS * 0.28)), bw = Math.max(1, canvas.width / BARS - gap);
      const grad = ctx.createLinearGradient(0, canvas.height, 0, 0);
      grad.addColorStop(0, 'rgba(243, 193, 90, 0.95)'); grad.addColorStop(1, 'rgba(234, 96, 121, 0.95)');
      ctx.fillStyle = grad;
      for (let i = 0; i < BARS; i += 1) {
        const h = Math.max(2 * ratio, (levels[i] / 255) * canvas.height);
        ctx.fillRect(i * (bw + gap) + gap / 2, canvas.height - h, bw, h);
      }
      raf = window.requestAnimationFrame(draw);
    };
    raf = window.requestAnimationFrame(draw);
    return () => { window.cancelAnimationFrame(raf); ctx.clearRect(0, 0, canvas.width, canvas.height); };
  }, [analyser, state, playing]);

  const note = state === 'unavailable' ? 'Meter unavailable for this source' : state === 'idle' ? (playing ? 'Meter not connected yet' : '') : (playing && silent ? 'No signal from this source' : '');
  return (
    <div className="onair-spectrum" data-testid="on-air-spectrum" data-meter={state}>
      <canvas ref={canvasRef} aria-hidden="true" />
      <div className="onair-spectrum-note" role="status">{note}</div>
    </div>
  );
}
