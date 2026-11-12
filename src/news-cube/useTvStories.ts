import { useCallback, useEffect, useState } from 'react';

export interface TvStoryDto {
  storyId: string;
  coverage: number;
  networks: string[];
  sharedTerms: string[];
  firstAirUtc: string;
  lastAirUtc: string;
  lead: { network: string; sourceKind: string; programTitle: string; identifier: string; windowStartUtc: string; minutes: { clock: string; text: string }[] };
  related: { network: string; programTitle: string; windowStartUtc: string }[];
}
export interface TvStoriesPayload {
  generatedAt: string;
  window: { requestedHours: number; coveredFromUtc: string | null; coveredToUtc: string | null; building: boolean };
  networks: Array<{ code: string; network: string; sourceKind: string; status: string; reason: string; cards: number }>;
  stories: TvStoryDto[];
}

/** Polls /api/tv-stories. `enabled` false = no request at all (tests pass a fetcher to the page and must stay offline). */
export function useTvStories(enabled: boolean, refreshMs = 5 * 60_000) {
  const [payload, setPayload] = useState<TvStoriesPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await fetch('/api/tv-stories', { signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as TvStoriesPayload;
      if (!j || !Array.isArray(j.stories)) throw new Error('unexpected response shape');
      setPayload(j);
      setError(null);
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      setError(String((e as Error)?.message ?? e));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const ac = new AbortController();
    void load(ac.signal);
    const t = window.setInterval(() => void load(ac.signal), refreshMs);
    return () => { ac.abort(); window.clearInterval(t); };
  }, [enabled, load, refreshMs]);

  return { payload, error, loading };
}
