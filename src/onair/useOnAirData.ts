/* Real data for the On Air side panels and ticker. Every value comes from an existing app source; when a source is empty or failed the
 * panel says so (or is left out of the rotation), it never shows made-up content. */
import { useEffect, useMemo, useState } from 'react';
import { useDigest } from '../hooks/useDigest';
import { AJN_PLAYOUT as E } from './engine.js';
import { PLACE_KEY, PREFS_KEY, defaultUnits, describeCode, forecastUrl, parseForecast, parsePrefs, parseStoredPlace, placeLabel, tempUnit, toTemp, toWind, windUnit, type WeatherReport } from '../utils/weather';
import type { Edition } from '../utils/dailyEdition';

export interface Headline { id: string; text: string; publishedMs: number; source: string }
import { tidyShowName } from './runOfShow';
export interface OnThisDay { date: string; title: string }
/** One real Archive.org item from /api/onair/on-this-day (usgovernmentmirrors, dated today's month/day in an earlier year). */
export interface ArchiveItem { identifier: string; title: string; collectionName: string; date: string; year: number; mediatype: 'texts' | 'audio' | 'movies'; thumbnail: string; url: string }
export interface OnAirData {
  headlines: Headline[]; digestLines: string[]; weatherLines: string[] | null; onThisDay: OnThisDay | null; archiveItems: ArchiveItem[]; missedLines: string[];
  digestStatus: 'loading' | 'ready' | 'error';
}
const WEATHER_POLL_MS = 15 * 60_000;

export function useOnAirData(edition: Edition | null, nowMs: number, headlineMaxAgeHours: number): OnAirData {
  const digest = useDigest();
  const [weather, setWeather] = useState<{ report: WeatherReport; label: string; units: 'us' | 'metric' } | null>(null);
  const [onThisDay, setOnThisDay] = useState<OnThisDay | null>(null);

  // Weather: the place already chosen on the Weather page. No saved place, no weather panel.
  useEffect(() => {
    let place = null as ReturnType<typeof parseStoredPlace>;
    try { place = parseStoredPlace(window.localStorage.getItem(PLACE_KEY)); } catch { /* storage unavailable */ }
    if (!place) { setWeather(null); return undefined; }
    const p = place;
    let units: 'us' | 'metric' = defaultUnits(navigator.language);
    try { units = parsePrefs(window.localStorage.getItem(PREFS_KEY)).units ?? units; } catch { /* keep default */ }
    let alive = true, timer: number | undefined, ctl: AbortController | null = null;
    const load = async (): Promise<void> => {
      ctl = new AbortController();
      try {
        const r = await fetch(forecastUrl(p), { signal: ctl.signal });
        if (!r.ok) throw new Error(`weather HTTP ${r.status}`);
        const report = parseForecast(await r.json(), Date.now());
        if (alive && report) setWeather({ report, label: placeLabel(p), units });
      } catch (e) { if ((e as Error).name !== 'AbortError' && alive) setWeather((w) => w); }
      if (alive) timer = window.setTimeout(() => { void load(); }, WEATHER_POLL_MS);
    };
    void load();
    return () => { alive = false; if (timer) window.clearTimeout(timer); ctl?.abort(); };
  }, []);

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
        if (r.ok && j?.status === 'ok' && j.generatedFor === denverDay && Array.isArray(j.items)) { if (alive) setArchiveItems(j.items.filter((i) => i && i.url && i.title)); return; }
        if (r.status === 202 && tries < 40) retryMs = 15_000;          // still building: ask again shortly
        else if (r.status >= 500 && tries < 6) retryMs = 10 * 60_000;  // unavailable: try again later, panel stays hidden meanwhile
      } catch (e) { if ((e as Error).name === 'AbortError') return; if (tries < 6) retryMs = 10 * 60_000; }
      tries += 1;
      if (alive && retryMs) timer = window.setTimeout(() => { void load(); }, retryMs);
    };
    void load();
    return () => { alive = false; ctl.abort(); if (timer) window.clearTimeout(timer); };
  }, [denverDay]);

  const dig = digest.data?.digest ?? null;
  const headlines = useMemo<Headline[]>(() => {
    const items = (dig?.top ?? []).filter((i) => i.publishedAt && Number.isFinite(Date.parse(i.publishedAt)));
    const mapped = items.map((i) => ({ id: i.id, text: i.title, publishedMs: Date.parse(i.publishedAt as string), source: i.source }));
    return (E.filterFreshHeadlines(mapped, nowMs, headlineMaxAgeHours) as Headline[]).sort((a, b) => b.publishedMs - a.publishedMs);
  }, [dig, Math.floor(nowMs / 60_000), headlineMaxAgeHours]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const missedLines = useMemo(() => [...new Set((edition?.shelves.missed ?? []).map((e) => tidyShowName(e.showName)))].slice(0, 3).map((n) => `Yesterday · ${n}`), [edition]);

  return { headlines, digestLines, weatherLines, onThisDay, archiveItems, missedLines, digestStatus: digest.phase };
}
