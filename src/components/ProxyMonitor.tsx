import { useEffect, useState } from 'react';
import { Activity, CheckCircle2, RefreshCw, Server, Zap, ShieldAlert, Radio } from 'lucide-react';
import { HealthResponse } from '../types';

export function ProxyMonitor() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastCheckTime, setLastCheckTime] = useState<string>('');

  const fetchHealth = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/health');
      if (res.ok) {
        const data: HealthResponse = await res.json();
        setHealth(data);
        setLastCheckTime(new Date().toLocaleTimeString());
      }
    } catch (err) {
      console.error('Failed to fetch proxy health', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 3000);
    return () => clearInterval(interval);
  }, []);

  const stats = health?.stats || {
    totalRequests: 0,
    successfulRequests: 0,
    retriedRequests: 0,
    failedRequests: 0,
    cacheHits: 0,
    lastUpstreamLatencyMs: 0,
    activeStreams: 0,
  };

  return (
    <div id="proxy-monitor-panel" className="rounded-xl border border-neutral-800 bg-neutral-900/70 p-6 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-800/80 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Radio className="h-5 w-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-neutral-100">Integrated Proxy & Media Gateway</h2>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400 border border-emerald-500/20">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span> Live
              </span>
            </div>
            <p className="text-xs text-neutral-400">Server-side exponential backoff, rate-limit shield & stream pipe</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-neutral-400">
            Updated: {lastCheckTime || 'Initializing...'}
          </span>
          <button
            id="refresh-health-btn"
            onClick={fetchHealth}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800/80 px-3 py-1.5 text-xs font-medium text-neutral-200 transition hover:bg-neutral-700 active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-neutral-800/80 bg-neutral-950/60 p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-400">Uptime</span>
            <Server className="h-4 w-4 text-neutral-400" />
          </div>
          <p className="mt-2 text-xl font-semibold tracking-tight text-neutral-100">
            {health?.uptime ? `${Math.floor(health.uptime)}s` : '0s'}
          </p>
          <span className="text-[11px] text-neutral-400">Express + Vite runtime</span>
        </div>

        <div className="rounded-lg border border-neutral-800/80 bg-neutral-950/60 p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-400">Total Requests</span>
            <Activity className="h-4 w-4 text-sky-400" />
          </div>
          <p className="mt-2 text-xl font-semibold tracking-tight text-sky-300">
            {stats.totalRequests}
          </p>
          <span className="text-[11px] text-neutral-400">{stats.successfulRequests} successful</span>
        </div>

        <div className="rounded-lg border border-neutral-800/80 bg-neutral-950/60 p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-400">503 Retries</span>
            <Zap className="h-4 w-4 text-amber-400" />
          </div>
          <p className="mt-2 text-xl font-semibold tracking-tight text-amber-300">
            {stats.retriedRequests}
          </p>
          <span className="text-[11px] text-neutral-400">Auto-shielded backoffs</span>
        </div>

        <div className="rounded-lg border border-neutral-800/80 bg-neutral-950/60 p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-400">Active Streams</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          </div>
          <p className="mt-2 text-xl font-semibold tracking-tight text-emerald-300">
            {stats.activeStreams}
          </p>
          <span className="text-[11px] text-neutral-400">{stats.lastUpstreamLatencyMs}ms last latency</span>
        </div>
      </div>
    </div>
  );
}
