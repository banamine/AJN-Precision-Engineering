import { useEffect, useState } from 'react';
import type { HomeNowItem } from '../../server/homeNow';

export interface HomeNowState {
  status: 'loading' | 'ready' | 'error';
  items: HomeNowItem[];
  /** Guides whose schedule was not ready yet (the server answers without them instead of waiting). */
  pending: string[];
  failed: string[];
}

const MIN_MS = 60_000;
const PENDING_RETRY_MS = 20_000;
const MAX_MS = 15 * 60_000;

/** One airing program per genre guide. Re-asks only when a shown program ends (nextChangeAt), never on a fast poll. */
export function useHomeNow(): HomeNowState {
  const [state, setState] = useState<HomeNowState>({ status: 'loading', items: [], pending: [], failed: [] });

  useEffect(() => {
    let alive = true;
    let timer: number | null = null;
    let controller: AbortController | null = null;

    const schedule = (ms: number) => {
      if (!alive) return;
      timer = window.setTimeout(run, Math.min(MAX_MS, Math.max(MIN_MS, ms)));
    };
    const run = async () => {
      if (!alive) return;
      if (document.hidden) { schedule(MIN_MS); return; }
      controller = new AbortController();
      try {
        const res = await fetch('/api/home/now', { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!alive) return;
        const items = Array.isArray(data.items) ? (data.items as HomeNowItem[]) : [];
        const pending = Array.isArray(data.pending) ? (data.pending as string[]) : [];
        setState({ status: 'ready', items, pending, failed: Array.isArray(data.failed) ? data.failed : [] });
        const next = typeof data.nextChangeAt === 'string' ? Date.parse(data.nextChangeAt) : NaN;
        if (pending.length > 0) timer = window.setTimeout(run, PENDING_RETRY_MS);
        else schedule(Number.isFinite(next) ? next - Date.now() + 2000 : MAX_MS);
      } catch (err) {
        if (!alive || (err as Error)?.name === 'AbortError') return;
        setState((s) => ({ ...s, status: s.items.length ? 'ready' : 'error' }));
        schedule(MIN_MS * 2);
      }
    };
    void run();
    return () => { alive = false; if (timer !== null) window.clearTimeout(timer); controller?.abort(); };
  }, []);

  return state;
}
