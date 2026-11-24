/* Declassified Desk stories for the On Air panels. Reads the same /api/desk the Desk page uses (the saved snapshot, so normally instant).
 * While the server is still building (202) it asks again later; on any failure it returns nothing and the panel simply shows what it already did. */
import { useEffect, useState } from 'react';
import type { DeskItem } from '../desk/useDesk';

export function useDeskStories(): DeskItem[] {
  const [items, setItems] = useState<DeskItem[]>([]);
  useEffect(() => {
    let alive = true, timer: number | undefined; const ctl = new AbortController(); let tries = 0;
    const load = async (): Promise<void> => {
      let retryMs = 0;
      try {
        const r = await fetch('/api/desk', { signal: ctl.signal, cache: 'no-store' });
        const j = (await r.json().catch(() => null)) as { items?: DeskItem[] } | null;
        if (r.ok && j && Array.isArray(j.items)) { if (alive) setItems(j.items.filter((i) => i && i.cardType === 'story' && i.lead && i.headline)); return; }
        if (r.status === 202 && tries < 40) retryMs = 15_000;
        else if (r.status >= 500 && tries < 4) retryMs = 10 * 60_000;
      } catch (e) { if ((e as Error).name === 'AbortError') return; if (tries < 4) retryMs = 10 * 60_000; }
      tries += 1;
      if (alive && retryMs) timer = window.setTimeout(() => { void load(); }, retryMs);
    };
    void load();
    return () => { alive = false; ctl.abort(); if (timer) window.clearTimeout(timer); };
  }, []);
  return items;
}
