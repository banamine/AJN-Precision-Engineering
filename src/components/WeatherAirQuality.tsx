import type { Src } from '../utils/fetchJson';
import { aqhiRisk, type Aqhi, type AqhiRisk } from '../utils/ecan';

/* Canada's Air Quality Health Index (1-10+, higher is worse). Colour + the word; shown only for places Environment Canada covers. */
const LOOK: Record<AqhiRisk, string> = { Low: 'bg-[#3fb950] text-[#0a0c10]', Moderate: 'bg-[#d29922] text-[#0a0c10]', High: 'bg-[#f85149] text-[#0a0c10]', 'Very high': 'bg-[#d946ef] text-[#0a0c10]' };
export function WeatherAirQuality({ state, tz, onRetry }: { state: Src<{ station: Aqhi | null }>; tz: string; onRetry: () => void }) {
  if (state.kind === 'error') {
    return (<div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-[#d29922] bg-[#3a2a05] p-3 text-sm font-semibold text-[#fff4d6]"><span className="min-w-0 flex-1">Air quality could not be checked ({state.message}).</span><button type="button" onClick={onRetry} className="ck-key ck-key--sm !min-h-[44px]">Retry</button></div>);
  }
  if (state.kind !== 'ok' || !state.data.station) return null;
  const a = state.data.station; const min = Math.max(0, Math.round((Date.now() - a.observed) / 60000)); const old = min > 180;
  let when = ''; try { when = new Date(a.observed).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: tz || undefined }); } catch { when = new Date(a.observed).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  return (
    <div data-testid="weather-aqhi" className="flex flex-wrap items-center gap-3 rounded-xl border border-neutral-700/70 bg-neutral-950/80 p-3 text-neutral-100">
      <span className={`rounded-md px-3 py-1 text-lg font-bold ${LOOK[aqhiRisk(a.value)]}`}>{a.value > 10 ? '10+' : a.value}</span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold text-neutral-50">Air quality (AQHI) · {a.risk} health risk</p>
        <p className={`text-xs ${old ? 'font-semibold text-[#e3b341]' : 'text-neutral-200'}`}>{old ? 'OLD READING · ' : ''}{a.station} · {Math.round(a.distanceMi)} mi away · observed {when} · scale 1 (best) to 10+</p>
      </div>
    </div>
  );
}
