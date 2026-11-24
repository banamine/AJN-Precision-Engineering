/* Loads the backfill pool (/api/onair/filler): real news clips, long Infowars-family files and The Quash back-catalog.
 * Failure is explicit: status 'error' with the reason; nothing is invented. Retries every 60 s while it has no usable pool. */
import { useEffect, useState } from 'react';
import type { FillerPool } from '../../server/onairFiller';

export type FillerStatus = 'loading' | 'ok' | 'error';
export interface FillerState { status: FillerStatus; pool: FillerPool | null; error: string | null }
const RETRY_MS = 60_000;
export const poolSize = (p: FillerPool | null): number => (p ? p.news.length + p.long.length + p.quash.length + (p.talk?.length ?? 0) + (p.harvey?.length ?? 0) + (p.rush?.length ?? 0) : 0);

export function useOnAirFiller(enabled = true): FillerState {
  const [state, setState] = useState<FillerState>({ status: 'loading', pool: null, error: null });
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true; let timer: number | null = null; let ctl: AbortController | null = null;
    const load = async (): Promise<void> => {
      ctl = new AbortController();
      try {
        const res = await fetch('/api/onair/filler', { signal: ctl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const pool = (await res.json()) as FillerPool;
        if (!alive) return;
        if (poolSize(pool) > 0) { setState({ status: 'ok', pool, error: null }); return; }
        setState({ status: 'error', pool: null, error: `no backfill clips available (${pool.missing?.slice(0, 2).join('; ') || 'empty pool'})` });
      } catch (e) {
        if ((e as Error).name === 'AbortError' || !alive) return;
        setState((s) => ({ status: s.pool ? 'ok' : 'error', pool: s.pool, error: e instanceof Error ? e.message : 'backfill pool unavailable' }));
      }
      if (alive) timer = window.setTimeout(() => { void load(); }, RETRY_MS);
    };
    void load();
    return () => { alive = false; if (timer) window.clearTimeout(timer); ctl?.abort(); };
  }, [enabled]);
  return state;
}
