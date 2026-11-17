import { useState } from 'react';
import type { Src } from '../utils/fetchJson';
import { ageLabel, ageMinutes, cloudText, describeTafGroup, fmtTime, inHg, tafRibbon, MAX_AIRPORT_MI, type FlightCategory, type NearStation, type Taf } from '../utils/aviation';
import { tempUnit, toTemp, type Units } from '../utils/weather';

/* Nearest airport: the measured report (METAR) and the airport forecast (TAF). Real readings only; each part fails on its own with a Retry key. */
/* explicit hex colours: the app theme turns the named green into its orange accent, which made VFR look orange */
const CHIP: Record<FlightCategory, string> = { VFR: 'bg-[#3fb950] text-[#0a0c10]', MVFR: 'bg-[#58a6ff] text-[#0a0c10]', IFR: 'bg-[#f85149] text-[#0a0c10]', LIFR: 'bg-[#d946ef] text-[#0a0c10]' };
export function CategoryChip({ category }: { category: FlightCategory | null }) {
  return category ? <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${CHIP[category]}`}>{category}</span> : <span className="rounded-md border border-neutral-500 px-2 py-0.5 text-xs font-bold text-neutral-100">NO CATEGORY</span>;
}
const Cell = ({ label, value }: { label: string; value: string }) => (<div className="rounded-lg border border-neutral-700/60 bg-neutral-900/80 p-2"><dt className="text-xs text-neutral-200">{label}</dt><dd className="text-sm font-semibold text-neutral-50">{value}</dd></div>);
const Retry = ({ onClick }: { onClick: () => void }) => <button type="button" onClick={onClick} className="ck-key ck-key--sm !min-h-[44px]">Retry</button>;
const warn = 'flex flex-wrap items-center gap-3 rounded-lg border border-[#d29922] bg-[#3a2a05] p-3 text-sm font-semibold text-[#fff4d6]';

interface Props { metars: Src<NearStation[]>; taf: Src<Taf | null>; selected: string | null; onSelect: (icao: string) => void; units: Units; tz: string; onRetryMetar: () => void; onRetryTaf: () => void }
export function WeatherAirport({ metars, taf, selected, onSelect, units, tz, onRetryMetar, onRetryTaf }: Props) {
  const [seg, setSeg] = useState<number | null>(null);
  return (
    <section data-testid="weather-airport" className="space-y-3 rounded-xl border border-neutral-700/70 bg-neutral-950/80 p-4 text-neutral-100" aria-label="Nearest airport">
      <h3 className="text-base font-semibold text-neutral-50">Nearest airport</h3>
      {(metars.kind === 'idle' || metars.kind === 'loading') && <p role="status" className="text-sm">Loading the airport report…</p>}
      {metars.kind === 'error' && <div role="alert" className={warn}><span className="min-w-0 flex-1">Airport report unavailable right now ({metars.message}).</span><Retry onClick={onRetryMetar} /></div>}
      {metars.kind === 'na' && <p className="text-sm">{metars.note}</p>}
      {metars.kind === 'ok' && metars.data.length === 0 && <p data-testid="weather-airport-none" className="text-sm">No airport reports within {MAX_AIRPORT_MI} miles of this place.</p>}
      {metars.kind === 'ok' && metars.data.length > 0 && (() => {
        const cur = metars.data.find((s) => s.metar.icao === selected) ?? metars.data[0]; const m = cur.metar;
        const min = ageMinutes(m.obsTime, Date.now()); const old = min > 90;
        const ribbon = taf.kind === 'ok' && taf.data ? tafRibbon(taf.data, Math.floor(Date.now() / 1000)) : [];
        const span = ribbon.length ? ribbon[ribbon.length - 1].to - ribbon[0].from : 0;
        const picked = seg !== null && taf.kind === 'ok' && taf.data ? ribbon[seg] : null;
        return (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 text-sm font-semibold text-neutral-50">{m.name} · {m.icao} · {Math.round(cur.distanceMi)} mi {cur.bearing}</p>
              <CategoryChip category={m.category} />
            </div>
            <p className={`text-xs ${old ? 'font-semibold text-[#e3b341]' : ''}`}>{old ? 'OLD REPORT · ' : ''}Observed {ageLabel(min)}</p>
            <dl data-testid="weather-metar" className="grid grid-cols-2 gap-2">
              <Cell label="Temperature" value={`${toTemp(m.tempC, units)}${tempUnit(units)}`} />
              <Cell label="Dew point" value={m.dewC === null ? '—' : `${toTemp(m.dewC, units)}${tempUnit(units)}`} />
              <Cell label="Wind" value={m.windKt === 0 ? 'Calm' : `${m.windVariable ? 'Variable' : m.windDir === null ? '—' : `${m.windDir}°`} ${m.windKt} kt${m.gustKt ? ` gust ${m.gustKt}` : ''}`} />
              <Cell label="Visibility" value={m.visibSm === null ? '—' : `${m.visibSm} SM`} />
              <Cell label="Sky" value={cloudText(m.clouds)} />
              <Cell label="Altimeter" value={`${inHg(m.altimInHg)} inHg`} />
            </dl>
            <p className="text-xs text-neutral-200">Airport readings use aviation units (kt, SM, inHg).</p>
            {metars.data.length > 1 && (
              <div className="space-y-1"><p className="text-xs text-neutral-200">Other airports nearby</p>
                <div className="flex flex-wrap gap-2">{metars.data.map((s) => (
                  <button key={s.metar.icao} type="button" aria-pressed={s.metar.icao === m.icao} onClick={() => { setSeg(null); onSelect(s.metar.icao); }} className={`ck-key ck-key--sm !min-h-[44px]${s.metar.icao === m.icao ? ' is-latched' : ''}`}>{s.metar.icao} · {Math.round(s.distanceMi)} mi</button>))}
                </div></div>)}

            <div className="space-y-2" data-testid="weather-taf">
              <p className="text-sm font-semibold text-neutral-50">Next 24 hours (airport forecast)</p>
              {(taf.kind === 'idle' || taf.kind === 'loading') && <p role="status" className="text-sm">Loading the airport forecast…</p>}
              {taf.kind === 'error' && <div role="alert" className={warn}><span className="min-w-0 flex-1">Airport forecast unavailable ({taf.message}).</span><Retry onClick={onRetryTaf} /></div>}
              {taf.kind === 'ok' && !taf.data && <p className="text-sm">{m.icao} does not publish a forecast (TAF).</p>}
              {taf.kind === 'ok' && taf.data && ribbon.length === 0 && <p className="text-sm">No forecast groups cover the next 24 hours.</p>}
              {taf.kind === 'ok' && taf.data && ribbon.length > 0 && (
                <>
                  <div className="flex overflow-hidden rounded-lg border border-neutral-600" role="list" aria-label="Flight category by time">
                    {ribbon.map((r, i) => (
                      <button key={`${r.from}-${i}`} type="button" role="listitem" aria-pressed={seg === i} onClick={() => setSeg(seg === i ? null : i)} style={{ width: `${((r.to - r.from) / span) * 100}%` }}
                        className={`min-h-[44px] min-w-[36px] truncate px-1 text-xs font-bold ${r.category ? CHIP[r.category] : 'bg-neutral-600 text-neutral-50'}${seg === i ? ' ring-2 ring-inset ring-white' : ''}`}>{r.category ?? '?'}</button>))}
                  </div>
                  <div className="flex justify-between text-xs text-neutral-200"><span>{fmtTime(ribbon[0].from, tz)}</span><span>{fmtTime(ribbon[ribbon.length - 1].to, tz)}</span></div>
                  {picked && <ul className="space-y-1 text-xs text-neutral-100">{taf.data.groups.filter((g) => g.change !== 'TEMPO' && !g.probability && g.from < picked.to && g.to > picked.from).map((g) => <li key={`${g.from}-${g.change}`}>{describeTafGroup(g, tz)}</li>)}</ul>}
                  <p className="text-xs text-neutral-200">Short TEMPO and PROB changes are not drawn; they are in the raw forecast below.</p>
                </>)}
            </div>
            <details className="text-xs">
              <summary className="min-h-[44px] cursor-pointer font-semibold leading-[44px] text-neutral-50">Raw METAR / TAF</summary>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded-lg bg-neutral-900 p-2 font-mono text-xs text-neutral-100">{m.raw || 'No raw METAR text.'}{taf.kind === 'ok' && taf.data ? `\n\n${taf.data.raw}` : ''}</pre>
            </details>
          </>);
      })()}
    </section>
  );
}
