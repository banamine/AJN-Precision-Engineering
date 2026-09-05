import { useState, useEffect, useRef } from 'react';
import { Volume2, Activity, CheckCircle, ShieldCheck } from 'lucide-react';

export function AudioBridgeStatus() {
  const [isAudioActive, setIsAudioActive] = useState<boolean>(false);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Simulated visual waveform monitor demonstrating single-owner audio pipeline
  useEffect(() => {
    let phase = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();

      const sliceWidth = canvas.width / 40;
      let x = 0;

      for (let i = 0; i < 40; i++) {
        const amplitude = isAudioActive ? Math.sin(i * 0.3 + phase) * 15 + Math.random() * 8 : Math.sin(i * 0.15 + phase) * 2;
        const y = canvas.height / 2 + amplitude;
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
        x += sliceWidth;
      }

      ctx.stroke();
      phase += 0.1;
      animationFrameRef.current = requestAnimationFrame(render);
    };

    render();
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isAudioActive]);

  return (
    <div id="audio-bridge-panel" className="rounded-xl border border-neutral-800 bg-neutral-900/70 p-6 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-800/80 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20">
            <Volume2 className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-neutral-100">AudioBridge Singleton Architecture (M1)</h2>
              <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-400 border border-sky-500/20">
                <ShieldCheck className="h-3 w-3" /> Zero-Collision Architecture
              </span>
            </div>
            <p className="text-xs text-neutral-400">
              Single-owner AudioContext + read-only diagnosticsAnalyserRef tap
            </p>
          </div>
        </div>

        <button
          id="toggle-audio-sim-btn"
          onClick={() => setIsAudioActive(!isAudioActive)}
          className={`flex items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-xs font-medium transition cursor-pointer ${
            isAudioActive
              ? 'border-sky-500/50 bg-sky-950/60 text-sky-300'
              : 'border-neutral-700 bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
          }`}
        >
          <Activity className="h-3.5 w-3.5" />
          {isAudioActive ? 'Active Stream Tap' : 'Test Analyser Tap'}
        </button>
      </div>

      <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 rounded-lg border border-neutral-800 bg-neutral-950/80 p-4">
          <div className="flex items-center justify-between text-xs text-neutral-400 mb-2">
            <span>Diagnostics Analyser Tap (Frequency & Scope)</span>
            <span className="font-mono text-sky-400">{isAudioActive ? 'Signal Live: 48kHz' : 'Standby'}</span>
          </div>
          <canvas
            ref={canvasRef}
            width={500}
            height={70}
            className="w-full h-16 rounded bg-neutral-950 border border-neutral-800/80"
          />
        </div>

        <div className="rounded-lg border border-neutral-800 bg-neutral-950/80 p-4 flex flex-col justify-center space-y-2 text-xs">
          <div className="flex items-center justify-between text-neutral-300">
            <span>Context Owner:</span>
            <span className="font-mono text-emerald-400">useAudioNormalization</span>
          </div>
          <div className="flex items-center justify-between text-neutral-300">
            <span>Diagnostics Hook:</span>
            <span className="font-mono text-sky-400">useSignalDiagnostics (Tap)</span>
          </div>
          <div className="flex items-center justify-between text-neutral-300">
            <span>MediaElementSource:</span>
            <span className="font-mono text-emerald-400">1 Node (Compliant)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
