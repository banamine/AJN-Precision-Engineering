import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { QUICK_PICKS } from '../utils/weatherQuickPicks';
import { WeatherAlerts } from './WeatherAlerts';
import { WeatherAirport } from './WeatherAirport';
import { WeatherAirQuality } from './WeatherAirQuality';
import { aqhiUrl, ecApplicable, ecWarningsUrl, parseAqhi, parseEcWarnings, type Aqhi } from '../utils/ecan';
import { fetchJson, HttpError, type Src } from '../utils/fetchJson';
import { alertsApplicable, alertsUrl, parseAlerts, type WxAlert } from '../utils/alerts';
import { ageLabel, ageMinutes, metarUrl, nearbyStations, parseMetarList, parseTaf, tafUrl, type NearStation, type Taf } from '../utils/aviation';
import { backdropFor, backdropUrl, defaultUnits, describeCode, forecastUrl, describeNetworkError, findPlaces, nextHours, parseForecast, parsePrefs, parseStoredPlace, placeLabel, tempUnit, toTemp, toWind, weekday, windUnit, LAST_KEY, PLACE_KEY, PREFS_KEY, type Units, type GeoHit, type WeatherPlace, type WeatherPrefs, type WeatherReport } from '../utils/weather';

/* Weather page (More menu). Real data from Open-Meteo, fetched in the browser; the chosen place is kept in this browser only.
 * States are explicit: no place, loading, error (with the reason), ready. No placeholder numbers are ever shown. */
type Status = { kind: 'idle' } | { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok' };
/* No background polling: what is on screen stays exactly as loaded until the person taps Refresh, picks another place, or reopens the page. */

function readPlace(): WeatherPlace | null { try { return parseStoredPlace(window.localStorage.getItem(PLACE_KEY)); } catch { return null; } }
const placeKey = (p: WeatherPlace) => `${p.latitude.toFixed(4)},${p.longitude.toFixed(4)}`;
/* The last real response is kept (raw, re-validated on read) so a failed refresh can show it clearly labelled out of date. Never shown for a different place. */
function readLast(p: WeatherPlace | null): WeatherReport | null {
  if (!p) return null;
  try { const v = JSON.parse(window.localStorage.getItem(LAST_KEY) ?? 'null'); return v && v.key === placeKey(p) && typeof v.fetchedAt === 'number' ? parseForecast(v.raw, v.fetchedAt) : null; } catch { return null; }
}
function saveLast(p: WeatherPlace, raw: unknown, fetchedAt: number) { try { window.localStorage.setItem(LAST_KEY, JSON.stringify({ key: placeKey(p), fetchedAt, raw })); } catch { /* storage full or blocked: only the out-of-date fallback is lost */ } }
function readPrefs(): WeatherPrefs { try { return parsePrefs(window.localStorage.getItem(PREFS_KEY)); } catch { return { units: null, plain: false }; } }
function savePrefs(v: WeatherPrefs) { try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(v)); } catch { /* not remembered this time */ } }
const hourLabel = (t: string) => { const h = Number(t.slice(11, 13)); return Number.isFinite(h) ? `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}` : t; };
function savePlace(p: WeatherPlace) { try { window.localStorage.setItem(PLACE_KEY, JSON.stringify(p)); } catch { /* storage blocked: the page still works for this visit */ } }

export function WeatherView() {
  const [place, setPlace] = useState<WeatherPlace | null>(() => readPlace());
  const [report, setReport] = useState<WeatherReport | null>(() => readLast(readPlace()));
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [prefs, setPrefs] = useState<WeatherPrefs>(() => readPrefs());
  const units: Units = prefs.units ?? defaultUnits(typeof navigator !== 'undefined' ? navigator.language : '');
  const updatePrefs = (next: WeatherPrefs) => { setPrefs(next); savePrefs(next); };
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<GeoHit[] | null>(null);
  const [searchMsg, setSearchMsg] = useState<{ text: string; warn?: boolean } | null>(null);
  const [imgOk, setImgOk] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const typeRef = useRef<AbortController | null>(null);

  const fetchReport = useCallback(async (p: WeatherPlace) => {
    abortRef.current?.abort(); const ac = new AbortController(); abortRef.current = ac;
    setStatus({ kind: 'loading' });
    try {
      const raw = await fetchJson(forecastUrl(p), ac.signal); const now = Date.now();
      const fresh = parseForecast(raw, now);
      if (!fresh) throw new Error('Weather service sent an incomplete answer');
      saveLast(p, raw, now); setReport(fresh); setStatus({ kind: 'ok' });
    } catch (e) {
      if (ac.signal.aborted) return;
      setStatus({ kind: 'error', message: describeNetworkError(e, 'api.open-meteo.com') });
    }
  }, []);

  useEffect(() => {
    if (!place) return undefined;
    void fetchReport(place);
    return () => { abortRef.current?.abort(); };
  }, [place, fetchReport]);

  /* Official alerts (US only) and airport reports: each source loads, refreshes and fails on its own. */
  const [alerts, setAlerts] = useState<Src<WxAlert[]>>({ kind: 'idle' });
  const [metars, setMetars] = useState<Src<NearStation[]>>({ kind: 'idle' });
  const [taf, setTaf] = useState<Src<Taf | null>>({ kind: 'idle' });
  const [stationId, setStationId] = useState<string | null>(null);
  const alertsAbort = useRef<AbortController | null>(null); const metarAbort = useRef<AbortController | null>(null); const tafAbort = useRef<AbortController | null>(null);
  const [alertSrc, setAlertSrc] = useState('');
  const [aqhi, setAqhi] = useState<Src<{ station: Aqhi | null }>>({ kind: 'idle' });
  const aqhiAbort = useRef<AbortController | null>(null);
  /* Alerts: US places ask the National Weather Service, Canadian places ask Environment Canada, "My location" tries the US first then Canada. */
  const loadAlerts = useCallback(async (p: WeatherPlace) => {
    alertsAbort.current?.abort();
    const us = alertsApplicable(p); const ca = ecApplicable(p);
    if (!us && !ca) { setAlerts({ kind: 'na', note: 'US and Canada only · not available here' }); return; }
    const ac = new AbortController(); alertsAbort.current = ac; setAlerts((l) => (l.kind === 'ok' ? l : { kind: 'loading' }));
    try {
      let list: WxAlert[] | null = null; let src = '';
      if (us) {
        try {
          list = parseAlerts(await fetchJson(alertsUrl(p), ac.signal), Date.now());
          if (!list) throw new Error('The National Weather Service sent an incomplete answer');
          src = 'NWS';
        } catch (e) { if (!(e instanceof HttpError && (e.status === 404 || e.status === 400) && ca)) throw e; }
      }
      if (list === null && ca) {
        const r = parseEcWarnings(await fetchJson(ecWarningsUrl(p), ac.signal), p, Date.now());
        if (!r) throw new Error('Environment Canada sent an incomplete answer');
        if (r.place === null) { setAlerts({ kind: 'na', note: 'no Environment Canada forecast point within 20 miles' }); return; }
        list = r.alerts; src = 'Environment Canada';
      }
      if (list === null) { setAlerts({ kind: 'na', note: 'US only · not available here' }); return; }
      setAlertSrc(src); setAlerts({ kind: 'ok', data: list, at: Date.now() });
    } catch (e) {
      if (ac.signal.aborted) return;
      if (e instanceof HttpError && (e.status === 404 || e.status === 400)) { setAlerts({ kind: 'na', note: 'US only · not available here' }); return; }
      setAlerts({ kind: 'error', message: describeNetworkError(e, ca && !us ? 'api.weather.gc.ca' : 'api.weather.gov') });
    }
  }, []);
  const loadAqhi = useCallback(async (p: WeatherPlace) => {
    aqhiAbort.current?.abort();
    if (!ecApplicable(p)) { setAqhi({ kind: 'na', note: 'Canada only' }); return; }
    const ac = new AbortController(); aqhiAbort.current = ac; setAqhi((l) => (l.kind === 'ok' ? l : { kind: 'loading' }));
    try {
      const r = parseAqhi(await fetchJson(aqhiUrl(p), ac.signal), p);
      if (!r) throw new Error('Environment Canada sent an incomplete answer');
      setAqhi({ kind: 'ok', data: r, at: Date.now() });
    } catch (e) { if (!ac.signal.aborted) setAqhi({ kind: 'error', message: describeNetworkError(e, 'api.weather.gc.ca') }); }
  }, []);
  const loadMetars = useCallback(async (p: WeatherPlace) => {
    metarAbort.current?.abort(); const ac = new AbortController(); metarAbort.current = ac; setMetars((l) => (l.kind === 'ok' ? l : { kind: 'loading' }));
    try {
      const body = await fetchJson(metarUrl(p.latitude, p.longitude), ac.signal);
      const data = (body as { data?: unknown } | null)?.data; if (!Array.isArray(data)) throw new Error('Airport service sent an incomplete answer');
      const near = nearbyStations(parseMetarList(data), p.latitude, p.longitude);
      setMetars({ kind: 'ok', data: near, at: Date.now() });
      setStationId((cur) => (cur && near.some((s) => s.metar.icao === cur) ? cur : near[0]?.metar.icao ?? null));
    } catch (e) { if (!ac.signal.aborted) setMetars({ kind: 'error', message: describeNetworkError(e, 'this app\'s airport service') }); }
  }, []);
  const loadTaf = useCallback(async (icao: string) => {
    tafAbort.current?.abort(); const ac = new AbortController(); tafAbort.current = ac; setTaf((l) => (l.kind === 'ok' ? l : { kind: 'loading' }));
    try {
      const body = await fetchJson(tafUrl(icao), ac.signal);
      const data = (body as { data?: unknown } | null)?.data; if (!Array.isArray(data)) throw new Error('Airport service sent an incomplete answer');
      setTaf({ kind: 'ok', data: data.length ? parseTaf(data) : null, at: Date.now() });
    } catch (e) { if (!ac.signal.aborted) setTaf({ kind: 'error', message: describeNetworkError(e, 'this app\'s airport service') }); }
  }, []);
  useEffect(() => {
    if (!place) return undefined;
    void loadAlerts(place); void loadMetars(place); void loadAqhi(place);
    return () => { alertsAbort.current?.abort(); metarAbort.current?.abort(); aqhiAbort.current?.abort(); };
  }, [place, loadAlerts, loadMetars, loadAqhi]);
  useEffect(() => {
    if (!stationId) { setTaf({ kind: 'idle' }); return undefined; }
    setTaf({ kind: 'loading' }); void loadTaf(stationId);
    return () => { tafAbort.current?.abort(); };
  }, [stationId, loadTaf]);

  /* Refresh re-asks every source once; each keeps its own result, and a failure shows only when the person asked for the refresh. */
  const refreshAll = (p: WeatherPlace) => { void fetchReport(p); void loadAlerts(p); void loadMetars(p); void loadAqhi(p); if (stationId) void loadTaf(stationId); };
  const choose = (p: WeatherPlace) => { savePlace(p); setAlerts({ kind: 'idle' }); setAqhi({ kind: 'idle' }); setMetars({ kind: 'idle' }); setTaf({ kind: 'idle' }); setStationId(null); setStatus({ kind: 'idle' }); setReport(readLast(p)); setPlace(p); setMatches(null); setQuery(''); setSearchMsg(null); setImgOk(true); };
  /* Autocomplete: runs ~0.3 s after typing stops; a newer keystroke cancels the older request. Enter / Search runs it at once. */
  const runSearch = useCallback(async (q: string, announce: boolean) => {
    typeRef.current?.abort(); const ac = new AbortController(); typeRef.current = ac;
    setSearchMsg({ text: 'Searching…' });
    try {
      const found = await findPlaces(q, (url) => fetchJson(url, ac.signal));
      if (ac.signal.aborted) return;
      setMatches(found);
      setSearchMsg(found.length ? (announce ? { text: 'Select a matching place below.' } : null) : { text: `No place found for "${q}". Try the city name, then a state, province or country.`, warn: true });
    } catch (err) { if (!ac.signal.aborted) { setMatches(null); setSearchMsg({ text: describeNetworkError(err, 'geocoding-api.open-meteo.com'), warn: true }); } }
  }, []);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { typeRef.current?.abort(); setMatches(null); if (!q) setSearchMsg(null); return undefined; }
    const t = window.setTimeout(() => void runSearch(q, false), 300);
    return () => window.clearTimeout(t);
  }, [query, runSearch]);
  useEffect(() => () => { typeRef.current?.abort(); }, []);
  const search = (e: FormEvent) => {
    e.preventDefault(); const q = query.trim(); if (q.length < 2) { setSearchMsg({ text: 'Type at least 2 letters of a city name.', warn: true }); return; }
    void runSearch(q, true);
  };
  const useMyLocation = () => {
    if (!('geolocation' in navigator)) { setSearchMsg({ text: 'This browser cannot share a location.', warn: true }); return; }
    setSearchMsg({ text: 'Waiting for your browser to share the location…' });
    navigator.geolocation.getCurrentPosition(
      (pos) => choose({ name: 'My location', region: '', country: '', latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      (err) => setSearchMsg({ text: err.code === err.PERMISSION_DENIED ? 'Location was blocked. Search for a city instead.' : 'Could not get your location. Search for a city instead.', warn: true }),
      { timeout: 10_000, maximumAge: 600_000 });
  };

  const stale = status.kind === 'error' && report !== null;
  const chosen = metars.kind === 'ok' ? (metars.data.find((x) => x.metar.icao === stationId) ?? metars.data[0]) : undefined;
  /* Measured vs forecast: only when both are real and the airport report is recent. */
  const reality = report && chosen && ageMinutes(chosen.metar.obsTime, Date.now()) <= 90 ? `Measured at ${chosen.metar.icao} ${toTemp(chosen.metar.tempC, units)}${tempUnit(units)} · forecast model ${toTemp(report.current.temperature, units)}${tempUnit(units)}` : null;
  const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const sources = [
    { name: 'Open-Meteo', dot: report ? '●' : '○', text: report ? `${stale ? 'last good ' : 'updated '}${clock(report.fetchedAt)}` : status.kind === 'error' ? 'failed' : 'loading' },
    { name: alerts.kind === 'ok' && alertSrc ? `${alertSrc} alerts` : 'Official alerts', dot: alerts.kind === 'ok' ? '●' : '○', text: alerts.kind === 'ok' ? `checked ${clock(alerts.at)}` : alerts.kind === 'na' ? alerts.note : alerts.kind === 'error' ? 'could not be checked' : 'checking' },
    ...(place && ecApplicable(place) ? [{ name: 'Air quality (EC)', dot: aqhi.kind === 'ok' && aqhi.data.station ? '●' : '○', text: aqhi.kind === 'ok' ? (aqhi.data.station ? `${aqhi.data.station.station} · checked ${clock(aqhi.at)}` : 'no station nearby') : aqhi.kind === 'error' ? 'could not be checked' : aqhi.kind === 'na' ? aqhi.note : 'checking' }] : []),
    { name: 'AviationWeather.gov', dot: metars.kind === 'ok' && chosen ? '●' : '○', text: metars.kind === 'ok' ? (chosen ? `${chosen.metar.icao} · ${ageLabel(ageMinutes(chosen.metar.obsTime, Date.now()))}` : 'no airport within 60 miles') : metars.kind === 'error' ? 'unavailable' : 'checking' },
  ];
  const bg = report && !prefs.plain ? backdropUrl(backdropFor(report.current.code, report.current.isDay)) : null;
  return (
    <section data-testid="weather-view" className="relative overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900">
      {imgOk && bg && <img key={bg} src={bg} alt="" aria-hidden onError={() => setImgOk(false)} className="absolute inset-0 h-full w-full object-cover" />}
      <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-neutral-950/70 via-neutral-950/60 to-neutral-950/85" />
      <div className="relative space-y-4 p-4 sm:p-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-neutral-50">Weather</h2>
            <p data-testid="weather-place" className="text-sm text-neutral-100">{place ? placeLabel(place) : 'Choose a place to see its weather.'}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" data-testid="weather-units" aria-pressed={units === 'metric'} onClick={() => updatePrefs({ ...prefs, units: units === 'us' ? 'metric' : 'us' })} className="ck-key ck-key--sm !min-h-[44px]">{units === 'us' ? '°F · mph' : '°C · km/h'}</button>
            <button type="button" data-testid="weather-plain" aria-pressed={prefs.plain} onClick={() => updatePrefs({ ...prefs, plain: !prefs.plain })} className="ck-key ck-key--sm !min-h-[44px]">{prefs.plain ? 'Photo background' : 'Plain background'}</button>
            {place && <button type="button" data-testid="weather-refresh" onClick={() => refreshAll(place)} className="ck-key ck-key--sm !min-h-[44px]">Refresh</button>}
          </div>
        </header>

        <form onSubmit={search} className="flex flex-col gap-2 sm:flex-row sm:items-center" role="search" aria-label="Find a place">
          <input data-testid="weather-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="City, e.g. Raleigh" aria-label="City name"
            autoComplete="off" className="min-h-[44px] w-full min-w-0 flex-1 rounded-lg border border-neutral-500 bg-neutral-800/95 px-3 text-sm text-neutral-50 placeholder:text-neutral-300" />
          <button type="submit" data-testid="weather-search-go" className="ck-key ck-key--sm is-latched !min-h-[44px]">Search</button>
          <button type="button" data-testid="weather-locate" onClick={useMyLocation} className="ck-key ck-key--sm !min-h-[44px]">Use my location</button>
        </form>
        <div data-testid="weather-quick" role="group" aria-label="Quick places" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {QUICK_PICKS.map((q) => {
            const on = !!place && Math.abs(place.latitude - q.place.latitude) < 0.01 && Math.abs(place.longitude - q.place.longitude) < 0.01;
            return <button key={q.label} type="button" aria-pressed={on} onClick={() => choose(q.place)} className={`ck-key ck-key--sm !min-h-[44px] shrink-0 whitespace-nowrap ${on ? 'is-latched' : ''}`}>{q.label}</button>;
          })}
        </div>
        {searchMsg ? <p role="status" className={`text-xs ${searchMsg.warn ? 'font-semibold text-amber-300' : 'text-neutral-100'}`}>{searchMsg.text}</p>
          : !place && <p className="text-xs text-neutral-100">Search for a city or use your current location.</p>}
        {matches && matches.length > 0 && (
          <ul data-testid="weather-matches" className="space-y-1">{matches.map((m) => (
            <li key={`${m.latitude},${m.longitude}`}><button type="button" onClick={() => choose({ name: m.name, region: m.region, country: m.country, latitude: m.latitude, longitude: m.longitude })} className="ck-key ck-key--sm ck-key--row !min-h-[44px] text-sm">{placeLabel(m)}</button></li>))}
          </ul>)}

        {place && <WeatherAlerts state={alerts} tz={report?.timezone ?? ''} onRetry={() => void loadAlerts(place)} />}
        {place && status.kind === 'loading' && <p role="status" className="text-sm text-neutral-100">{report ? 'Refreshing…' : 'Loading the forecast…'}</p>}
        {place && status.kind === 'error' && (report
          ? <p role="alert" data-testid="weather-stale" className="rounded-lg border border-amber-400/60 bg-amber-950/70 p-3 text-sm font-semibold text-amber-100">OUT OF DATE. Could not refresh ({status.message}). Showing the last forecast received at {new Date(report.fetchedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.</p>
          : <p role="alert" data-testid="weather-error" className="rounded-lg border border-red-500/50 bg-red-950/60 p-3 text-sm text-red-100">Could not load the weather: {status.message}. Nothing is shown rather than a guess.</p>)}
        <div className={place ? 'grid gap-4 lg:grid-cols-[3fr_2fr]' : ''}>
        <div className="min-w-0 space-y-4">
        {report && (
          <>
            <div data-testid="weather-current" className="flex flex-wrap items-end gap-x-6 gap-y-2">
              <p className="text-5xl font-bold leading-none text-neutral-50">{toTemp(report.current.temperature, units)}{tempUnit(units)}</p>
              <div className="text-sm text-neutral-100">
                <p className="text-base font-medium">{describeCode(report.current.code)}</p>
                <p>Feels like {toTemp(report.current.feelsLike, units)}{tempUnit(units)} · Humidity {Math.round(report.current.humidity)}% · Wind {toWind(report.current.windKmh, units)} {windUnit(units)}</p>
              </div>
            </div>
            <ul data-testid="weather-days" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {report.days.map((d) => (
                <li key={d.date} className="last:col-span-2 sm:last:col-span-1 rounded-xl border border-neutral-700/70 bg-neutral-950/70 p-3 text-sm text-neutral-100">
                  <p className="font-semibold">{weekday(d.date)}</p>
                  <p className="text-xs text-neutral-200">{describeCode(d.code)}</p>
                  <p className="mt-1">{toTemp(d.high, units)}° / {toTemp(d.low, units)}°</p>
                  {d.precipChance !== null && <p className="text-xs text-neutral-200">Precip. chance {Math.round(d.precipChance)}%</p>}
                </li>))}
            </ul>
            {nextHours(report).length > 0 && (
              <details data-testid="weather-hourly" className="rounded-xl border border-neutral-700/70 bg-neutral-950/70 p-3 text-sm text-neutral-100">
                <summary className="min-h-[44px] cursor-pointer font-semibold leading-[44px]">Next 12 hours</summary>
                <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">{nextHours(report).map((h) => (
                  <li key={h.time} className="rounded-lg border border-neutral-700/60 p-2"><p className="font-semibold">{hourLabel(h.time)}</p><p>{toTemp(h.temperature, units)}{tempUnit(units)}</p><p className="text-xs text-neutral-200">{describeCode(h.code)}</p>{h.precipChance !== null && <p className="text-xs text-neutral-200">Precip. {Math.round(h.precipChance)}%</p>}</li>))}
                </ul>
              </details>)}
            {place && ecApplicable(place) && <WeatherAirQuality state={aqhi} tz={report.timezone} onRetry={() => void loadAqhi(place)} />}
            {reality && <p data-testid="weather-reality" className="rounded-lg border border-neutral-700/60 bg-neutral-950/70 p-2 text-sm text-neutral-100">{reality}</p>}
            <p className="text-xs text-neutral-100">{stale ? 'Last updated' : 'Updated'} {new Date(report.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · refreshes every 15 minutes while this page is open</p>
          </>
        )}
        </div>
        {place && <WeatherAirport metars={metars} taf={taf} selected={stationId} onSelect={setStationId} units={units} tz={report?.timezone ?? ''} onRetryMetar={() => void loadMetars(place)} onRetryTaf={() => stationId && void loadTaf(stationId)} />}
        </div>
        {place && (
          <ul data-testid="weather-sources" className="flex flex-wrap gap-2 text-xs text-neutral-100" aria-label="Data sources">
            {sources.map((x) => <li key={x.name} className="rounded-md border border-neutral-600 bg-neutral-950/80 px-2 py-1"><span aria-hidden>{x.dot} </span>{x.name} · {x.text}</li>)}
          </ul>)}
        <p className="text-xs text-neutral-100">Weather data by <a className="underline" href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo.com</a> (CC BY 4.0, non-commercial use). Alerts: National Weather Service (US) and Environment and Climate Change Canada. Air quality: Environment and Climate Change Canada. Airport data: AviationWeather.gov. Your place is saved in this browser only.</p>
      </div>
    </section>
  );
}
