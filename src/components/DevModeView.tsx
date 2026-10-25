import React, { useState } from 'react';
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
  CloudUpload,
  Settings,
  Trash2,
} from 'lucide-react';
import { ProxyMonitor } from './ProxyMonitor';
import { ProxyTester } from './ProxyTester';
import { AudioBridgeStatus } from './AudioBridgeStatus';
import { Destination, RecentlyPlayedItem } from '../types';
import { syncRecentlyPlayed, SYNC_ENDPOINT, type SyncResult } from '../utils/cloudSync';

const RECENTLY_PLAYED_KEY = 'ajn.recentlyPlayed.v1'; // same key App uses; read only as a fallback when no list is passed in
function readStoredRecentlyPlayed(): RecentlyPlayedItem[] {
  try { const v = JSON.parse(window.localStorage.getItem(RECENTLY_PLAYED_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** Removes this app's localStorage entries (every key starting with "ajn": recently played, history, favorites, recent searches, resume positions, settings). Other keys on the same origin are kept.
 *  Returns how many entries were removed, or null if storage is unavailable. */
export function clearAppData(storage: Pick<Storage, 'length' | 'key' | 'removeItem'> | null = typeof window !== 'undefined' ? safeStorage() : null): number | null {
  if (!storage) return null;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && /^ajn/i.test(k)) keys.push(k);
    }
    keys.forEach((k) => storage.removeItem(k));
    return keys.length;
  } catch { return null; }
}
function safeStorage(): Storage | null { try { return window.localStorage; } catch { return null; } }

interface DevModeViewProps {
  onNavigate: (dest: Destination) => void;
  /** The live recently-played list from App. Falls back to the saved copy when omitted. */
  recentlyPlayed?: RecentlyPlayedItem[];
}

export function DevModeView({ onNavigate, recentlyPlayed }: DevModeViewProps) {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<(SyncResult & { at: string }) | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearMsg, setClearMsg] = useState<string | null>(null);
  const doClear = () => {
    const n = clearAppData();
    if (n === null) { setClearMsg('Could not clear: browser storage is unavailable.'); setConfirmClear(false); return; }
    setClearMsg(`Cleared ${n} saved entr${n === 1 ? 'y' : 'ies'}. Reloading…`);
    setConfirmClear(false);
    window.setTimeout(() => window.location.reload(), 600);
  };
  const items = recentlyPlayed ?? readStoredRecentlyPlayed();
  const runSync = async () => {
    if (syncing) return;
    setSyncing(true);
    const r = await syncRecentlyPlayed(items);
    setSyncResult({ ...r, at: new Date().toLocaleTimeString() });
    setSyncing(false);
  };
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

      {/* ── Settings ─────────────────────────────────────────────────────── */}
      <section aria-labelledby="dev-settings-heading" data-testid="dev-settings" className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
        <h2 id="dev-settings-heading" className="flex items-center gap-2 text-sm font-semibold text-neutral-100"><Settings className="h-4 w-4 text-neutral-400" />Settings</h2>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-xs text-neutral-400">
            <div className="font-semibold text-neutral-200">Cloud sync · Recently played</div>
            <p className="mt-0.5">Sends your {items.length} most recent item{items.length === 1 ? '' : 's'} to <code className="font-mono text-neutral-300">{SYNC_ENDPOINT}</code>. This is a <strong>placeholder</strong> endpoint: it checks the data and replies, but nothing is stored yet.</p>
          </div>
          <button type="button" id="sync-to-cloud-btn" data-testid="sync-to-cloud" onClick={() => void runSync()} disabled={syncing}
            className="flex shrink-0 items-center justify-center gap-2 rounded-xl border border-sky-500/50 bg-sky-500/10 px-4 py-2.5 text-xs font-semibold text-sky-200 transition hover:bg-sky-500/20 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
            {syncing ? <RefreshCw className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <CloudUpload className="h-3.5 w-3.5" />}
            {syncing ? 'Syncing…' : 'Sync to cloud'}
          </button>
        </div>
        <div aria-live="polite" data-testid="sync-status" className="mt-3 text-xs">
          {!syncResult && <span className="text-neutral-500">Not synced in this session.</span>}
          {syncResult && syncResult.ok && <span className="text-emerald-300">{syncResult.at} · {syncResult.received} item{syncResult.received === 1 ? '' : 's'} received. {syncResult.stored ? 'Stored.' : 'Not stored (placeholder endpoint).'}</span>}
          {syncResult && !syncResult.ok && <span className="text-red-300">{syncResult.at} · Sync failed: {'reason' in syncResult ? syncResult.reason : 'unknown'}</span>}
        </div>
        <div className="mt-4 border-t border-neutral-800 pt-4" data-testid="clear-app-data">
          {!confirmClear ? (
            <button type="button" data-testid="clear-app-data-btn" onClick={() => { setClearMsg(null); setConfirmClear(true); }}
              className="inline-flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400">
              <Trash2 className="h-3.5 w-3.5" /> Clear App Data
            </button>
          ) : (
            <div role="alertdialog" aria-label="Confirm clear app data" className="space-y-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
              <p>This erases everything saved in this browser: recently played, history, favorites, recent searches, resume positions and settings. It cannot be undone.</p>
              <p className="text-red-300/80">If you are signed in, cloud sync may bring favorites and history back afterwards. Your sign-in itself is not removed.</p>
              <div className="flex gap-2">
                <button type="button" data-testid="clear-app-data-confirm" onClick={doClear} className="rounded-md bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300">Yes, erase everything</button>
                <button type="button" data-testid="clear-app-data-cancel" onClick={() => setConfirmClear(false)} className="rounded-md border border-neutral-600 px-3 py-1.5 text-neutral-200 hover:bg-neutral-800">Cancel</button>
              </div>
            </div>
          )}
          {clearMsg && <p role="status" className="mt-2 text-xs text-neutral-300">{clearMsg}</p>}
        </div>
        <details className="mt-3 text-xs text-neutral-400">
          <summary className="cursor-pointer text-neutral-300">How to use</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Play a few items so the recently-played list has entries (it keeps the last 5).</li>
            <li>Open Developer Mode (address ending <code className="font-mono">#dev</code>) and find Settings.</li>
            <li>Press <strong>Sync to cloud</strong>. Nothing syncs automatically.</li>
            <li>Read the status line: "N items received · Not stored" means the placeholder accepted them. A red message means the sync failed and says why.</li>
          </ol>
        </details>
      </section>

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
