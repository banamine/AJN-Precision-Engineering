// Loads /api/home/classic-48h (a ~30 kB slice, not the 20+ MB Classic schedule). Honest states: loading, ready (maybe stale), pending, error.
import { useCallback, useEffect, useRef, useState } from 'react';

export interface UpcomingWire {
  generatedAt: string | null; stale: boolean; pending: boolean; windowStartMs: number; windowEndMs: number;
  channels: Array<{ id: string; name: string; logo?: string; programs: Array<{ programId: string; assetId?: string; sourceId?: string; title: string; startMs: number; endMs: number; path: string; mediaType: 'video' | 'audio' }> }>;
}
export interface UpcomingView { phase: 'idle' | 'loading' | 'ready' | 'error'; data: UpcomingWire | null; error: string | null; retry: () => void }

const PENDING_RETRY_MS = 20_000;
const REFRESH_MS = 10 * 60_000;

export function useClassicUpcoming(enabled: boolean): UpcomingView {
  const [state, setState] = useState<{ phase: UpcomingView['phase']; data: UpcomingWire | null; error: string | null }>({ phase: 'idle', data: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const controller = new AbortController();
    const schedule = (ms: number) => { if (alive) timer.current = window.setTimeout(run, ms); };
    async function run() {
      if (!alive) return;
      if (document.hidden) { schedule(REFRESH_MS); return; }
      try {
        const res = await fetch(`/api/home/classic-48h?tz=${new Date().getTimezoneOffset()}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as UpcomingWire;
        if (!alive) return;
        if (!Array.isArray(data.channels)) throw new Error('response had no channels');
        setState({ phase: 'ready', data, error: null });
        schedule(data.pending ? PENDING_RETRY_MS : REFRESH_MS);
      } catch (err) {
        if (!alive || (err as Error)?.name === 'AbortError') return;
        setState((s) => ({ phase: s.data ? 'ready' : 'error', data: s.data, error: err instanceof Error ? err.message : String(err) }));
        schedule(REFRESH_MS);
      }
    }
    setState((s) => (s.data ? s : { phase: 'loading', data: null, error: null }));
    void run();
    return () => { alive = false; controller.abort(); if (timer.current !== null) window.clearTimeout(timer.current); };
  }, [enabled, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
