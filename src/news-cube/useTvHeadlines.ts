import { useCallback, useEffect, useState } from 'react';

export type TvItem =
  | { network: string; state: 'ok'; programTitle: string; identifier: string; airedUtc: string; excerptMinutes: { clock: string; startSec: number; text: string }[]; stale?: boolean; staleReason?: string; lowSignal?: boolean; sameTopicAs?: string[]; sharedTerms?: string[] }
  | { network: string; state: 'unavailable'; reason: string };

export function useTvHeadlines(refreshMs = 20 * 60_000) {
  const [items, setItems] = useState<TvItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/tv-headlines');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setItems(Array.isArray(j.items) ? j.items : []);
      setError(null);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), refreshMs);
    return () => window.clearInterval(t);
  }, [load, refreshMs]);
  return { items, error, loading, refresh: load };
}
