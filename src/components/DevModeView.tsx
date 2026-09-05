import React from 'react';
import {
  Terminal,
  ArrowLeft,
  Server,
  Activity,
  ShieldCheck,
  Zap,
  Radio,
  Cpu,
  RefreshCw,
} from 'lucide-react';
import { ProxyMonitor } from './ProxyMonitor';
import { ProxyTester } from './ProxyTester';
import { AudioBridgeStatus } from './AudioBridgeStatus';
import { Destination } from '../types';

interface DevModeViewProps {
  onNavigate: (dest: Destination) => void;
}

export function DevModeView({ onNavigate }: DevModeViewProps) {
  return (
    <div className="space-y-8 pb-16">
      {/* ── Developer Mode Header ────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-neutral-800 pb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/25">
              <Terminal className="h-4 w-4" />
            </div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-neutral-50">
              Engineering & Diagnostics Console
            </h1>
            <span className="rounded bg-amber-500/10 px-2.5 py-0.5 text-xs font-mono font-medium text-amber-400 border border-amber-500/20">
              Developer Mode
            </span>
          </div>
          <p className="text-xs text-neutral-400">
            Real-time proxy telemetry, live media probing, and AudioBridge singleton architecture inspection.
          </p>
        </div>

        <button
          type="button"
          id="exit-dev-mode-btn"
          onClick={() => onNavigate('home')}
          className="flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-2 text-xs font-medium text-neutral-200 transition hover:bg-neutral-700 hover:text-white cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Consumer App
        </button>
      </div>

      {/* ── Telemetry Overview Cards ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
          <div className="flex items-center justify-between text-xs text-neutral-400">
            <span>Audio Graph (M1)</span>
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
          </div>
          <p className="mt-2 text-sm font-semibold text-neutral-100">Single-Owner Singleton</p>
          <p className="mt-1 text-[11px] text-neutral-400">
            Zero-collision AudioContext + read-only diagnostics tap.
          </p>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
          <div className="flex items-center justify-between text-xs text-neutral-400">
            <span>Media Gateway</span>
            <Server className="h-4 w-4 text-sky-400" />
          </div>
          <p className="mt-2 text-sm font-semibold text-neutral-100">Range Clamping (2MB)</p>
          <p className="mt-1 text-[11px] text-neutral-400">
            Exponential backoff shield & rate-limit retry pipeline.
          </p>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
          <div className="flex items-center justify-between text-xs text-neutral-400">
            <span>TV News Slicing</span>
            <Activity className="h-4 w-4 text-purple-400" />
          </div>
          <p className="mt-2 text-sm font-semibold text-neutral-100">300s Continuous Slice</p>
          <p className="mt-1 text-[11px] text-neutral-400">
            12 segment auto-advance sequence across 60 min broadcast.
          </p>
        </div>
      </div>

      {/* ── Diagnostic Modules Stack ─────────────────────────────────────── */}
      <div className="space-y-6">
        {/* Module 1: Integrated Proxy & Media Gateway */}
        <section aria-labelledby="proxy-monitor-heading">
          <ProxyMonitor />
        </section>

        {/* Module 2: AudioBridge Singleton Visualizer */}
        <section aria-labelledby="audio-bridge-heading">
          <AudioBridgeStatus />
        </section>

        {/* Module 3: Live Media & Proxy Inspector */}
        <section aria-labelledby="proxy-tester-heading">
          <ProxyTester />
        </section>
      </div>
    </div>
  );
}
