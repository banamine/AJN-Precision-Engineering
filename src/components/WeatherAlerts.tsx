import { AlertTriangle } from 'lucide-react';
import type { Src } from '../utils/fetchJson';
import type { AlertSeverity, WxAlert } from '../utils/alerts';

/* Official US alerts (National Weather Service). Shows nothing when there are none or the place is outside the US;
 * a failed check says so (it never reads as "all clear"). Severity is always colour + the word. */
const LOOK: Record<AlertSeverity, string> = {
  /* explicit hex colours: the app theme remaps some named Tailwind colours */
  Extreme: 'border-[#f85149] bg-[#3b0d0d] text-[#fff1f0]', Severe: 'border-[#f85149] bg-[#3b0d0d] text-[#fff1f0]',
  Moderate: 'border-[#d29922] bg-[#3a2a05] text-[#fff4d6]', Minor: 'border-[#58a6ff] bg-[#0b2540] text-[#e6f1ff]', Unknown: 'border-[#58a6ff] bg-[#0b2540] text-[#e6f1ff]',
};
function until(ms: number | null, tz: string): string {
  if (ms === null) return '';
  try { return ` until ${new Date(ms).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: tz || undefined })}`; } catch { return ''; }
}
export function WeatherAlerts({ state, tz, onRetry }: { state: Src<WxAlert[]>; tz: string; onRetry: () => void }) {
  if (state.kind === 'error') {
    return (
      <div role="alert" data-testid="weather-alerts-error" className="flex flex-wrap items-center gap-3 rounded-xl border border-[#d29922] bg-[#3a2a05] p-3 text-sm font-semibold text-[#fff4d6]">
        <span className="min-w-0 flex-1">Official alerts could not be checked ({state.message}).</span>
        <button type="button" onClick={onRetry} className="ck-key ck-key--sm !min-h-[44px]">Retry</button>
      </div>);
  }
  if (state.kind !== 'ok' || state.data.length === 0) return null;
  return (
    <ul data-testid="weather-alerts" className="space-y-2" aria-label="Official weather alerts">
      {state.data.map((a) => (
        <li key={a.id}>
          <details className={`rounded-xl border-l-4 border ${LOOK[a.severity]} p-3 text-sm`}>
            <summary className="flex min-h-[44px] cursor-pointer items-center gap-2 font-semibold">
              <AlertTriangle aria-hidden className="h-5 w-5 shrink-0" />
              <span>{a.severity.toUpperCase()} · {a.event}{until(a.expires, tz)}{a.sender ? ` · ${a.sender}` : ''}</span>
            </summary>
            <div className="mt-2 space-y-1 text-neutral-50">
              {a.headline && <p>{a.headline}</p>}
              {a.area && <p className="text-xs">{a.area.startsWith('Issued') ? a.area : `Area: ${a.area}`}</p>}
              {a.url && <p className="text-xs"><a className="underline" href={a.url} target="_blank" rel="noreferrer noopener">Full report from {a.sender || 'the issuer'}</a></p>}
            </div>
          </details>
        </li>))}
    </ul>
  );
}
