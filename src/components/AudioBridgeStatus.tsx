import { useEffect, useRef, useState } from 'react';
import { Activity, Copy, ShieldCheck, Volume2 } from 'lucide-react';

interface AudioBridgeStatusProps {
  analyser?: AnalyserNode | null;
  bufferLine?: string;
  onCopyBufferLog?: () => Promise<boolean>;
}

const BAR_COUNT = 120;

export function AudioBridgeStatus({ analyser = null, bufferLine = "Buffer: idle", onCopyBufferLog }: AudioBridgeStatusProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const signalActiveRef = useRef(false);
  const [signalActive, setSignalActive] = useState(false);
  const [copyLabel, setCopyLabel] = useState('Copy buffer log');

  const copyBufferLog = async () => {
    setCopyLabel(onCopyBufferLog && await onCopyBufferLog() ? 'Copied' : 'Copy failed');
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (analyser) {
      // Keep the tap responsive to normal programme audio instead of relying
      // on the browser's very wide default dB range.
      analyser.smoothingTimeConstant = 0.72;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -10;
    }

    const frequencyData = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (!analyser || !frequencyData) {
        if (signalActiveRef.current) {
          signalActiveRef.current = false;
          setSignalActive(false);
        }
        animationFrameRef.current = requestAnimationFrame(render);
        return;
      }

      analyser.getByteFrequencyData(frequencyData);

      let peak = 0;
      let total = 0;
      for (let i = 0; i < frequencyData.length; i += 1) {
        peak = Math.max(peak, frequencyData[i]);
        total += frequencyData[i];
      }
      const average = frequencyData.length > 0 ? total / frequencyData.length : 0;
      const nextSignalActive = peak > 8 || average > 3;
      if (signalActiveRef.current !== nextSignalActive) {
        signalActiveRef.current = nextSignalActive;
        setSignalActive(nextSignalActive);
      }

      const barWidth = canvas.width / BAR_COUNT;
      for (let bar = 0; bar < BAR_COUNT; bar += 1) {
        const start = Math.floor((bar / BAR_COUNT) * frequencyData.length);
        const end = Math.max(start + 1, Math.floor(((bar + 1) / BAR_COUNT) * frequencyData.length));
        let value = 0;
        for (let i = start; i < end && i < frequencyData.length; i += 1) {
          value = Math.max(value, frequencyData[i]);
        }

        // Convert the real analyser byte value into a visible height while
        // retaining a small floor so all 120 real bins remain identifiable.
        const normalized = Math.min(1, value / 255);
        const barHeight = Math.max(2, normalized * canvas.height);
        const x = bar * barWidth;
        const y = canvas.height - barHeight;

        ctx.fillStyle = value > 8 ? '#38bdf8' : '#1f2937';
        ctx.fillRect(x + 0.5, y, Math.max(1, barWidth - 1), barHeight);
      }

      animationFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [analyser]);

  return (
    <div id="audio-bridge-panel" className="rounded-xl border border-neutral-800 bg-neutral-900/70 p-6 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-800/80 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-sky-500/20 bg-sky-500/10 text-sky-400">
            <Volume2 className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-neutral-100">AudioBridge Singleton Architecture (M1)</h2>
              <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-400">
                <ShieldCheck className="h-3 w-3" /> Zero-Collision Architecture
              </span>
            </div>
            <p className="text-xs text-neutral-400">
              Single-owner AudioContext + read-only diagnostics analyser tap
            </p>
          </div>
        </div>

        <span className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-3.5 py-1.5 text-xs font-medium text-neutral-300">
          <Activity className="h-3.5 w-3.5" />
          {analyser ? (signalActive ? 'Analyzer Active' : 'Analyzer Ready') : 'Analyzer Unavailable'}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-800 bg-neutral-950/80 px-3 py-2.5">
        <div role="status" data-testid="buffer-gauge-line" className="flex min-w-0 items-center gap-2 text-sm text-neutral-200">
          <Activity className="h-4 w-4 shrink-0 text-sky-400" aria-hidden="true" />
          <span className="truncate">{bufferLine}</span>
        </div>
        {onCopyBufferLog && (
          <button type="button" data-testid="copy-buffer-log" onClick={() => void copyBufferLog()}
            className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-md border border-neutral-700 px-3 text-xs font-medium text-neutral-200 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />{copyLabel}
          </button>
        )}
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-neutral-800 bg-neutral-950/80 p-4 md:col-span-2">
          <div className="mb-2 flex items-center justify-between text-xs text-neutral-400">
            <span>Diagnostics Analyser Tap — 120 real frequency bars</span>
            <span className="font-mono text-sky-400">
              {analyser ? (signalActive ? 'Signal Active' : 'Waiting for Signal') : 'No Analyser'}
            </span>
          </div>
          <canvas
            ref={canvasRef}
            width={960}
            height={120}
            aria-label="Real-time audio frequency visualizer"
            className="h-24 w-full rounded border border-neutral-800/80 bg-neutral-950"
          />
        </div>

        <div className="flex flex-col justify-center space-y-2 rounded-lg border border-neutral-800 bg-neutral-950/80 p-4 text-xs">
          <div className="flex items-center justify-between text-neutral-300">
            <span>Context Owner:</span>
            <span className="font-mono text-emerald-400">useAudioNormalization</span>
          </div>
          <div className="flex items-center justify-between text-neutral-300">
            <span>Diagnostics Hook:</span>
            <span className="font-mono text-sky-400">Existing analyser tap</span>
          </div>
          <div className="flex items-center justify-between text-neutral-300">
            <span>MediaElementSource:</span>
            <span className="font-mono text-emerald-400">1 shared node</span>
          </div>
        </div>
      </div>
    </div>
  );
}
