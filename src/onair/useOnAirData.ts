/* Real data for the On Air side panels and ticker. Every value comes from an existing app source; when a source is empty or failed the
 * panel says so (or is left out of the rotation), it never shows made-up content. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDigest } from '../hooks/useDigest';
import { AJN_PLAYOUT as E } from './engine.js';
import { PREFS_KEY, defaultUnits, describeCode, forecastUrl, parseForecast, parsePrefs, placeLabel, tempUnit, toTemp, toWind, windUnit, type WeatherPlace, type WeatherReport } from '../utils/weather';
import type { Edition } from '../utils/dailyEdition';
import type { CityPhotoResponse, CityPhoto } from '../../server/cityPhotos';
/** Same key the server uses for the city (see server/cityPhotos.ts CITY_CATEGORIES). */
export const cityKeyOf = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export interface Headline { id: string; text: string; publishedMs: number; source: string }
export interface OnThisDay { date: string; title: string }
/** One real Archive.org item from /api/onair/on-this-day (usgovernmentmirrors, dated today's month/day in an earlier year). */
export interface ArchiveItem { identifier: string; title: string; collectionName: string; date: string; year: number; mediatype: 'texts' | 'audio' | 'movies'; thumbnail: string; url: string }
export interface OnAirData {
  headlines: Headline[]; digestLines: string[]; weatherLines: string[] | null; onThisDay: OnThisDay | null; archiveItems: ArchiveItem[];
  /** Weather card background for the city on screen (null until loaded, or when none is available). */
  weatherPhoto: CityPhoto | null;
  digestStatus: 'loading' | 'ready' | 'error';
}
const WEATHER_POLL_MS = 15 * 60_000;
/** The weather panel rotates through these cities (chosen by the owner), one at a time. */
export const WEATHER_CITIES: readonly WeatherPlace[] = [
  { name: 'New York City', region: 'New York', country: 'United States', latitude: 40.7128, longitude: -74.006 },
  { name: 'Toronto', region: 'Ontario', country: 'Canada', latitude: 43.6532, longitude: -79.3832 },
  { name: 'Los Angeles', region: 'California', country: 'United States', latitude: 34.0522, longitude: -118.2437 },
  { name: 'Vancouver', region: 'British Columbia', country: 'Canada', latitude: 49.2827, longitude: -123.1207 },
  { name: 'Chicago', region: 'Illinois', country: 'United States', latitude: 41.8781, longitude: -87.6298 },
  { name: 'Montreal', region: 'Quebec', country: 'Canada', latitude: 45.5017, longitude: -73.5673 },
  { name: 'San Francisco', region: 'California', country: 'United States', latitude: 37.7749, longitude: -122.4194 },
  { name: 'Ottawa', region: 'Ontario', country: 'Canada', latitude: 45.4215, longitude: -75.6972 },
  { name: 'Boston', region: 'Massachusetts', country: 'United States', latitude: 42.3601, longitude: -71.0589 },
  { name: 'Calgary', region: 'Alberta', country: 'Canada', latitude: 51.0447, longitude: -114.0719 },
  { name: 'Miami', region: 'Florida', country: 'United States', latitude: 25.7617, longitude: -80.1918 },
  { name: 'Quebec City', region: 'Quebec', country: 'Canada', latitude: 46.8139, longitude: -71.208 },
];
/** A new city every 5 minutes, in list order (US and Canada alternate). Pure: the city is a function of the clock. */
export const WEATHER_CITY_MS = 5 * 60_000;
export const weatherCityAt = (ms: number): WeatherPlace => WEATHER_CITIES[Math.floor(ms / WEATHER_CITY_MS) % WEATHER_CITIES.length];

export function useOnAirData(_edition: Edition | null, nowMs: number, headlineMaxAgeHours: number): OnAirData {
  const digest = useDigest();
  const [weather, setWeather] = useState<{ report: WeatherReport; label: string; units: 'us' | 'metric' } | null>(null);
  const weatherCache = useRef(new Map<string, { report: WeatherReport }>());
  const [onThisDay, setOnThisDay] = useState<OnThisDay | null>(null);
  // One random value per page load: the photo for each city stays the same while the page is open, and changes on a reload.
  const photoSeed = useRef(Math.random().toString(36).slice(2, 12));
  const photoCache = useRef(new Map<string, CityPhoto | null>());
  const [weatherPhoto, setWeatherPhoto] = useState<CityPhoto | null>(null);

  // Weather: rotates through WEATHER_CITIES (a new city every 5 minutes). Each city's forecast is fetched when it comes up and re-fetched after 15 minutes.
  const city = weatherCityAt(nowMs);
  const cityKey = placeLabel(city);
  useEffect(() => {
    let units: 'us' | 'metric' = defaultUnits(navigator.language);
    try { units = parsePrefs(window.localStorage.getItem(PREFS_KEY)).units ?? units; } catch { /* keep default */ }
    const cached = weatherCache.current.get(cityKey);
    if (cached && Date.now() - cached.report.fetchedAt < WEATHER_POLL_MS) { setWeather({ report: cached.report, label: cityKey, units }); return undefined; }
    let alive = true; const ctl = new AbortController();
    (async (): Promise<void> => {
      try {
        const r = await fetch(forecastUrl(city), { signal: ctl.signal });
        if (!r.ok) throw new Error(`weather HTTP ${r.status}`);
        const report = parseForecast(await r.json(), Date.now());
        if (alive && report) { weatherCache.current.set(cityKey, { report }); setWeather({ report, label: cityKey, units }); }
      } catch { /* AbortError or a failed fetch: keep the last city's report; the panel is built only from what was fetched */ }
    })();
    return () => { alive = false; ctl.abort(); };
  }, [cityKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // City photo: one request per city per page session (the server caches the list for a day). Failure or no photo = no background, never a broken image.
  const photoKey = cityKeyOf(city.name);
  useEffect(() => {
    const have = photoCache.current;
    if (have.has(photoKey)) { setWeatherPhoto(have.get(photoKey) ?? null); return undefined; }
    setWeatherPhoto(null);
    let alive = true; const ctl = new AbortController();
    (async (): Promise<void> => {
      try {
        const r = await fetch(`/api/onair/city-photo?city=${encodeURIComponent(photoKey)}&seed=${photoSeed.current}`, { signal: ctl.signal, cache: 'no-store' });
        const j = (await r.json()) as CityPhotoResponse;
        const photo = r.ok && j.status === 'ok' && j.photo && /^https:\/\//.test(j.photo.url) ? j.photo : null;
        if (j.status !== 'error') have.set(photoKey, photo);   // an error is retried the next time the city comes round
        if (alive) setWeatherPhoto(photo);
      } catch { /* AbortError or network failure: no background */ }
    })();
    return () => { alive = false; ctl.abort(); };
  }, [photoKey]);

  // On this day: the Rush Limbaugh library has a recording for today's calendar date in an earlier year.
  const denverDay = useMemo(() => { const p = E.denverParts(nowMs) as { month: number; day: number }; return `${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; }, [Math.floor(nowMs / 3_600_000)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let alive = true;
    import('../data/rushIndex.json').then((mod) => {
      if (!alive) return;
      const rows = (mod.default as unknown as Array<{ date?: string; role?: string }>).filter((r) => typeof r.date === 'string' && r.date.slice(5) === denverDay && (!r.role || r.role === 'full-show'));
      if (!rows.length) { setOnThisDay(null); return; }
      const pick = rows[rows.length - 1];
      setOnThisDay({ date: pick.date as string, title: 'The Rush Limbaugh Show' });
    }).catch(() => { if (alive) setOnThisDay(null); });
    return () => { alive = false; };
  }, [denverDay]);

  // From the Archive: server builds the day's list in the background (202 = building). Accept only a list generated for TODAY's Denver month/day; anything else hides the panel.
  const [archiveItems, setArchiveItems] = useState<ArchiveItem[]>([]);
  useEffect(() => {
    let alive = true, timer: number | undefined; const ctl = new AbortController(); let tries = 0;
    setArchiveItems([]);
    const load = async (): Promise<void> => {
      let retryMs = 0;
      try {
        const r = await fetch('/api/onair/on-this-day', { signal: ctl.signal, cache: 'no-store' });
        const j = (await r.json().catch(() => null)) as { status?: string; generatedFor?: string; items?: ArchiveItem[] } | null;
        if (r.ok && j?.status === 'ok' && j.generatedFor === denverDay && Array.isArray(j.items)) { if (alive) setArchiveItems(j.items.filter((i) => i && i.url && i.title && i.mediatype !== 'audio')); return; }
        if (r.status === 202 && tries < 40) retryMs = 15_000;          // still building: ask again shortly
        else if (r.status >= 500 && tries < 6) retryMs = 10 * 60_000;  // unavailable: try again later, panel stays hidden meanwhile
      } catch (e) { if ((e as Error).name === 'AbortError') return; if (tries < 6) retryMs = 10 * 60_000; }
      tries += 1;
      if (alive && retryMs) timer = window.setTimeout(() => { void load(); }, retryMs);
    };
    void load();
    return () => { alive = false; ctl.abort(); if (timer) window.clearTimeout(timer); };
  }, [denverDay]);

  // More news: 13 public RSS feeds fetched by the server (/api/onair/extra-news). Failure leaves the digest headlines as they were; nothing is invented.
  const [extraNews, setExtraNews] = useState<Headline[]>([]);
  useEffect(() => {
    let alive = true, timer: number | undefined; const ctl = new AbortController();
    const load = async (): Promise<void> => {
      let next = 15 * 60_000;
      try {
        const r = await fetch('/api/onair/extra-news', { signal: ctl.signal, cache: 'no-store' });
        const j = (await r.json().catch(() => null)) as { status?: string; items?: Array<{ id: string; title: string; source: string; publishedAt: string }> } | null;
        if (r.ok && j?.status === 'ok' && Array.isArray(j.items)) { if (alive) setExtraNews(j.items.filter((i) => i && i.title && Number.isFinite(Date.parse(i.publishedAt))).map((i) => ({ id: i.id, text: i.title, publishedMs: Date.parse(i.publishedAt), source: i.source }))); }
        else next = 2 * 60_000;
      } catch (e) { if ((e as Error).name === 'AbortError') return; next = 2 * 60_000; }
      if (alive) timer = window.setTimeout(() => { void load(); }, next);
    };
    void load();
    return () => { alive = false; ctl.abort(); if (timer) window.clearTimeout(timer); };
  }, []);

  const dig = digest.data?.digest ?? null;
  const headlines = useMemo<Headline[]>(() => {
    const items = (dig?.top ?? []).filter((i) => i.publishedAt && Number.isFinite(Date.parse(i.publishedAt)));
    const mapped = items.map((i) => ({ id: i.id, text: i.title, publishedMs: Date.parse(i.publishedAt as string), source: i.source }))
    const seenText = new Set(mapped.map((m) => m.text.toLowerCase()));
    for (const x of extraNews) if (!seenText.has(x.text.toLowerCase())) { seenText.add(x.text.toLowerCase()); mapped.push(x); }
    return (E.filterFreshHeadlines(mapped, nowMs, headlineMaxAgeHours) as Headline[]).sort((a, b) => b.publishedMs - a.publishedMs);
  }, [dig, extraNews, Math.floor(nowMs / 60_000), headlineMaxAgeHours]); // eslint-disable-line react-hooks/exhaustive-deps

  const digestLines = useMemo(() => (dig?.briefing ?? []).slice(0, 4).map((b) => `• ${b.headline}`), [dig]);
  const weatherLines = useMemo<string[] | null>(() => {
    if (!weather) return null;
    const { report: r, units, label } = weather; const c = r.current; const d0 = r.days[0];
    return [
      `${label} — ${toTemp(c.temperature, units)}${tempUnit(units)} · ${describeCode(c.code)}`,
      `Wind ${toWind(c.windKmh, units)} ${windUnit(units)} · Humidity ${Math.round(c.humidity)}%`,
      d0 ? `Today: high ${toTemp(d0.high, units)}${tempUnit(units)} · low ${toTemp(d0.low, units)}${tempUnit(units)}` : '',
    ].filter(Boolean);
  }, [weather]);
  return { headlines, digestLines, weatherLines, onThisDay, archiveItems, weatherPhoto, digestStatus: digest.phase };
}
