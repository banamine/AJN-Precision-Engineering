import { useEffect, useState, type ReactElement } from 'react';
import { Radio, ArrowRight } from 'lucide-react';
import { requestRadioDock } from '../utils/radioDock';

/** Live-page entry to the Radio dock. Shows the real station count from the server; never a made-up number. */
export function LiveRadioBand(): ReactElement {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    fetch('/api/live-radio/status')
      .then((res) => (res.ok ? (res.json() as Promise<{ enabled: number }>) : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((d) => { if (active && typeof d.enabled === 'number') setCount(d.enabled); })
      .catch(() => { /* count stays hidden; the button still opens the panel */ });
    return () => { active = false; };
  }, []);
  return (
    <section aria-label="Live radio" data-testid="live-radio-band"
      className="flex flex-wrap items-center gap-3 rounded-2xl border border-red-700/50 bg-gradient-to-r from-red-950/70 via-neutral-950 to-neutral-950 px-4 py-3 sm:px-5">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-red-600 text-white shadow-lg shadow-red-900/40"><Radio className="h-6 w-6" aria-hidden="true" /></div>
      <div className="mr-auto min-w-0">
        <h2 className="text-base font-semibold tracking-tight text-neutral-100">Live Radio</h2>
        <p className="text-xs text-neutral-400">{count ? `${count.toLocaleString()} stations, US + Canada` : 'US + Canada stations'} · pictures, search by city, plays while you browse</p>
      </div>
      <button type="button" data-testid="live-radio-open" onClick={() => requestRadioDock('open')}
        className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full bg-gradient-to-br from-orange-500 to-red-600 px-5 text-sm font-extrabold uppercase tracking-wider text-white shadow-lg shadow-red-900/40 transition hover:from-orange-400 hover:to-red-500 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white touch-manipulation">
        Open Radio <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </section>
  );
}
