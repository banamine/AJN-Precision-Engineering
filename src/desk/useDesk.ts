import { useCallback, useEffect, useRef, useState } from 'react';
import type { DeskFeed, DeskItem } from '../../server/desk';
import { decodeDeskItem } from './decodeEntities';

export type { DeskItem, DeskFeed };
export type DeskState =
  | { phase: 'loading' }
  | { phase: 'building' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; feed: DeskFeed };

/** Loads /api/desk. 202 means the server is still building the day's cards: poll. Any failure is shown as-is, with a retry; nothing is faked. */
export function useDesk(): DeskState & { retry: () => void } {
  const [state, setState] = useState<DeskState>({ phase: 'loading' });
  const [tick, setTick] = useState(0);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    const load = async () => {
      try {
        const res = await fetch('/api/desk', { signal: ctl.signal });
        const body = await res.json().catch(() => null) as (Partial<DeskFeed> & { status?: string; error?: string }) | null;
        if (res.status === 202) {
          setState({ phase: 'building' });
          timer.current = window.setTimeout(load, 4000);
          return;
        }
        if (!res.ok || !body || !Array.isArray(body.items)) {
          setState({ phase: 'error', message: body?.error || `The desk could not be loaded (HTTP ${res.status}).` });
          return;
        }
        setState({ phase: 'ready', feed: { ...(body as DeskFeed), items: (body as DeskFeed).items.map(decodeDeskItem) } });
      } catch (e) {
        if (ctl.signal.aborted) return;
        setState({ phase: 'error', message: e instanceof Error ? e.message : 'The desk could not be loaded.' });
      }
    };
    setState({ phase: 'loading' });
    void load();
    return () => { ctl.abort(); if (timer.current) window.clearTimeout(timer.current); };
  }, [tick]);

  const retry = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, retry } as DeskState & { retry: () => void };
}
