import { useCallback, useEffect, useRef, useState } from 'react';

export interface ChyronVariant { channel: string; tsMs: number; text: string; identifier: string; startSec: number; program: string; rows: number; onScreenSec: number }
export interface ChyronStory { id: string; tsMs: number; channels: string[]; text: string; program: string; identifier: string; startSec: number; onScreenSec: number; variants: ChyronVariant[] }
export interface ChyronData {
  status: 'ok' | 'stale' | 'unavailable'; generatedAt: string | null; newestRowUtc: string | null; coverageFromUtc: string | null;
  staleReason?: string; error?: string; total: number; items: ChyronStory[];
}
export interface ChyronQuery { hours: number; q?: string; channel?: string; limit?: number; refreshMs?: number; token?: number }

/** Loads /api/tv-chyrons. A failed refresh keeps the last good data on screen and reports `error`; it never fakes a fresh result. */
export function useTvChyrons({ hours, q = '', channel = '', limit = 60, refreshMs = 5 * 60_000, token = 0 }: ChyronQuery) {
  const [data, setData] = useState<ChyronData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    abortRef.current?.abort();
    const ac = new AbortController(); abortRef.current = ac;
    setLoading(true);
    try {
      const url = `/api/tv-chyrons?hours=${hours}&limit=${limit}&q=${encodeURIComponent(q)}&channel=${encodeURIComponent(channel)}`;
      const res = await fetch(url, { signal: ac.signal, cache: 'no-store' });
      const body = await res.json().catch(() => null);
      if (seq !== seqRef.current) return;
      if (!res.ok || !body || !Array.isArray(body.items)) throw new Error(body?.error || `Headlines HTTP ${res.status}`);
      setData(body as ChyronData); setError(null);
    } catch (e) {
      if (seq !== seqRef.current || (e as Error)?.name === 'AbortError') return;
      setError(e instanceof Error ? e.message : 'Headlines could not be loaded.');
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [hours, q, channel, limit]);

  useEffect(() => { void load(); return () => { seqRef.current++; abortRef.current?.abort(); }; }, [load, token]);
  useEffect(() => {
    if (refreshMs <= 0) return;
    const t = window.setInterval(() => { if (document.visibilityState !== 'hidden') void load(); }, refreshMs);
    return () => window.clearInterval(t);
  }, [load, refreshMs]);

  return { data, error, loading, refresh: load };
}
