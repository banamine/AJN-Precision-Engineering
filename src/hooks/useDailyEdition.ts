/* Loads the daily "Today's podcasts" edition from /api/podcasts/edition.
 * Client-frozen per Denver date: once an edition for a date is adopted, later responses for the SAME date never replace it (so the list the
 * listener sees cannot shift under them); a response for a NEWER date is adopted (the controller finishes the current episode first).
 * Polls about every 30 minutes while the tab is visible. A "new episodes" notice appears only after a poll, never on first load. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Edition, ShelfEpisode } from '../utils/dailyEdition';
import { editionToPool } from '../utils/editionPool';
import type { SchedPool } from '../utils/roundRobinSchedule';

export const POLL_MS = 30 * 60_000;
export interface EditionNotice { count: number; items: ShelfEpisode[] }
export type EditionLoadStatus = 'loading' | 'ok' | 'building' | 'degraded' | 'error';
export interface DailyEditionState {
  status: EditionLoadStatus; edition: Edition | null; pool: SchedPool | null; staleFeeds: string[]; notice: EditionNotice | null; error: string | null;
  dismissNotice: () => void; refresh: () => void;
}
interface Resp { editionStatus?: 'ok' | 'building' | 'degraded'; staleFeeds?: string[]; edition?: Edition | null }

export function useDailyEdition(enabled: boolean, fetchImpl: typeof fetch = fetch): DailyEditionState {
  const [status, setStatus] = useState<EditionLoadStatus>('loading');
  const [edition, setEdition] = useState<Edition | null>(null);
  const [staleFeeds, setStale] = useState<string[]>([]);
  const [notice, setNotice] = useState<EditionNotice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const adopted = useRef<Edition | null>(null);
  const seenNew = useRef<Set<string> | null>(null);
  const lastPollAt = useRef(0);
  const inflight = useRef(false);

  const poll = useCallback(async () => {
    if (inflight.current) return; inflight.current = true; lastPollAt.current = Date.now();
    try {
      const res = await fetchImpl('/api/podcasts/edition', { cache: 'no-store' });
      if (!res.ok) throw new Error(`edition HTTP ${res.status}`);
      const data = (await res.json()) as Resp; const next = data.edition ?? null;
      setError(null); setStale(data.staleFeeds ?? []); setStatus(data.editionStatus ?? 'ok');
      if (!next) return;                                                     // still building: keep what we have
      const cur = adopted.current;
      const slotsOf = (e: Edition): number => e.loop.length + e.tail.length;
      if (!cur || next.dateKey > cur.dateKey || (next.dateKey === cur.dateKey && slotsOf(cur) === 0 && slotsOf(next) > 0)) { // first edition, a newer Denver date, or a real edition replacing an empty one
        adopted.current = next; setEdition(next);
        seenNew.current = new Set(next.shelves.new.map((e) => e.guid)); setNotice(null);
      } else if (next.dateKey === cur.dateKey) {                               // same date: list stays frozen; only the New shelf may grow
        const seen = seenNew.current ?? new Set<string>();
        const fresh = next.shelves.new.filter((e) => !seen.has(e.guid));
        if (fresh.length) { fresh.forEach((e) => seen.add(e.guid)); seenNew.current = seen; setNotice((n) => ({ count: (n?.count ?? 0) + fresh.length, items: [...(n?.items ?? []), ...fresh] })); }
        if (next.shelves.new.length !== cur.shelves.new.length || next.shelves.notInLoop.length !== cur.shelves.notInLoop.length) { const merged = { ...cur, shelves: next.shelves, counts: next.counts }; adopted.current = merged; setEdition(merged); }
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'edition unavailable'); setStatus((s) => (s === 'loading' ? 'error' : s)); }
    finally { inflight.current = false; }
  }, [fetchImpl]);

  useEffect(() => {
    if (!enabled) return undefined;
    void poll();
    const tick = () => { if (document.visibilityState === 'visible' && Date.now() - lastPollAt.current >= POLL_MS) void poll(); };
    const id = window.setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [enabled, poll]);

  const pool = useMemo(() => (edition ? editionToPool(edition) : null), [edition?.editionId]); // eslint-disable-line react-hooks/exhaustive-deps
  const dismissNotice = useCallback(() => setNotice(null), []);
  return { status, edition, pool, staleFeeds, notice, error, dismissNotice, refresh: () => { void poll(); } };
}
