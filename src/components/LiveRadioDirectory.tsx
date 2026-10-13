import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { PlayProgramCallback } from '../types';

interface LiveRadioItem {
  id: string;
  name: string;
  country: 'US' | 'CA';
  city?: string;
  region?: string;
  timeZone?: string;
  callSign?: string;
  description?: string;
  genres: string[];
  streamUrl: string;
  streamType: 'mp3' | 'aac' | 'hls' | 'icy';
  programId: string;
}

interface LiveRadioPageResponse {
  total: number;
  page: number;
  pageSize: number;
  items: LiveRadioItem[];
  countries: Array<'US' | 'CA'>;
  genres: string[];
  regions: string[];
  cities: string[];
}

const COUNTRY_NAMES: Record<'US' | 'CA', string> = { US: 'United States', CA: 'Canada' };
const FAVORITES_KEY = 'ajn-live-radio-favorites-v1';
const PAGE_SIZE = 24;

function loadFavorites(): Set<string> {
  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveFavorites(ids: Set<string>): void {
  try {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify([...ids]));
  } catch {
    /* storage unavailable: favorites last for this visit only */
  }
}

/** Station-local time, e.g. "3:42 PM PDT". Only when the record carries a real IANA zone; otherwise nothing is shown. */
function localTimeLabel(timeZone: string | undefined, now: number): string | null {
  if (!timeZone) return null;
  try {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone }).format(now);
  } catch {
    return null;
  }
}

function initialsOf(name: string): string {
  const letters = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const first = letters[0] ?? '?';
  return (first.length >= 2 ? first.slice(0, 2) : first + (letters[1]?.[0] ?? '')).toUpperCase();
}

/** Deterministic dark tile colour from the station id (no randomness). */
function tileColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `hsl(${h} 28% 22%)`;
}

export function LiveRadioDirectory({ onPlay }: { onPlay: PlayProgramCallback }): ReactElement {
  const [query, setQuery] = useState<string>('');
  const [debounced, setDebounced] = useState<string>('');
  const [country, setCountry] = useState<string>('');
  const [genre, setGenre] = useState<string>('');
  const [region, setRegion] = useState<string>('');
  const [city, setCity] = useState<string>('');
  const [now, setNow] = useState<number>(() => Date.now());
  const [favoritesOnly, setFavoritesOnly] = useState<boolean>(false);
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites());
  const [page, setPage] = useState<number>(1);
  const [data, setData] = useState<LiveRadioPageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [reloadKey, setReloadKey] = useState<number>(0);
  const facets = useRef<{ countries: Array<'US' | 'CA'>; genres: string[] }>({ countries: [], genres: [] });

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => { setPage(1); }, [debounced, country, region, city, genre, favoritesOnly]);

  const favoriteIds = [...favorites].join(',');
  useEffect(() => {
    // Favorites-only with no favorites is an empty list, not "every station".
    if (favoritesOnly && favorites.size === 0) {
      setData({ total: 0, page: 1, pageSize: PAGE_SIZE, items: [], countries: facets.current.countries, genres: facets.current.genres, regions: [], cities: [] });
      setLoading(false);
      setError(null);
      return undefined;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (debounced) params.set('q', debounced);
    if (country) params.set('country', country);
    if (region) params.set('region', region);
    if (city) params.set('city', city);
    if (genre) params.set('genre', genre);
    if (favoritesOnly) params.set('ids', favoriteIds);
    setLoading(true);
    fetch(`/api/live-radio/stations?${params.toString()}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<LiveRadioPageResponse>;
      })
      .then((json) => {
        facets.current = { countries: json.countries, genres: json.genres };
        setData(json);
        setError(null);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : 'request failed');
        setLoading(false);
      });
    return () => controller.abort();
  }, [page, debounced, country, region, city, genre, favoritesOnly, favoriteIds, favorites.size, reloadKey]);

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = new Set<string>(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      saveFavorites(next);
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setQuery(''); setDebounced(''); setCountry(''); setRegion(''); setCity(''); setGenre(''); setFavoritesOnly(false);
  }, []);

  const play = (s: LiveRadioItem): void => {
    const where = [s.city, s.region].filter(Boolean).join(', ');
    onPlay(s.streamUrl, s.name, where || COUNTRY_NAMES[s.country], 'audio', s.id, 'audio-podcasts', s.programId);
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtering = Boolean(debounced || country || region || city || genre || favoritesOnly);

  return (
    <section id="live-radio-directory" aria-label="Live radio directory" data-testid="live-radio-directory"
      className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-4 shadow-2xl">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-amber-400/80">Live Radio · US + Canada</p>
          <h2 className="text-lg font-semibold text-neutral-100">
            Stations <span className="text-sm font-normal text-neutral-500" data-testid="live-radio-count">({data ? data.total : '…'})</span>
          </h2>
        </div>
        <button type="button" aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly((v) => !v)}
          className={`rounded-full border px-3 py-1 text-xs cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
            favoritesOnly ? 'border-amber-400/70 bg-amber-500/20 text-amber-200' : 'border-neutral-700 text-neutral-300 hover:bg-neutral-800'}`}>
          ♥ Favorites <b className="tabular-nums">{favorites.size}</b>
        </button>
      </div>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <label className="flex-1">
          <span className="sr-only">Search stations</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search stations, cities, genres..." autoComplete="off"
            data-testid="live-radio-search"
            className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400" />
        </label>
        <label>
          <span className="sr-only">Filter by country</span>
          <select value={country} onChange={(e) => { setCountry(e.target.value); setRegion(''); setCity(''); }} data-testid="live-radio-country"
            className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 sm:w-40">
            <option value="">All countries</option>
            {facets.current.countries.map((c) => <option key={c} value={c}>{COUNTRY_NAMES[c]}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">Filter by province or state</span>
          <select value={region} onChange={(e) => { setRegion(e.target.value); setCity(''); }} data-testid="live-radio-region"
            className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 sm:w-48">
            <option value="">{country === 'CA' ? 'All provinces' : country === 'US' ? 'All states' : 'All states / provinces'}</option>
            {(data?.regions ?? []).map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">Filter by city</span>
          <select value={city} onChange={(e) => setCity(e.target.value)} disabled={!region} data-testid="live-radio-city"
            title={region ? undefined : 'Choose a state or province first'}
            className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 disabled:opacity-50 sm:w-44">
            <option value="">{region ? 'All cities' : 'City (pick a state first)'}</option>
            {(data?.cities ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>

      <div role="group" aria-label="Filter by genre" className="mb-3 flex gap-1.5 overflow-x-auto pb-0.5">
        {['', ...facets.current.genres].map((g) => (
          <button key={g || 'all'} type="button" aria-pressed={genre === g} onClick={() => setGenre(g)} data-genre={g}
            className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
              genre === g ? 'border-amber-400/60 bg-amber-500/20 text-amber-100' : 'border-neutral-700 text-neutral-300 hover:bg-neutral-800'}`}>
            {g || 'All genres'}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" data-testid="live-radio-error" className="rounded-lg border border-red-900/60 bg-red-950/30 p-4 text-sm text-red-200">
          Could not load stations ({error}).
          <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="ml-3 rounded border border-red-800 px-2 py-0.5 text-xs hover:bg-red-900/40 cursor-pointer">Retry</button>
        </div>
      )}

      {!error && data && data.items.length === 0 && !loading && (
        <div role="status" data-testid="live-radio-empty" className="p-8 text-center text-sm text-neutral-400">
          {filtering ? 'No stations match.' : 'No live radio stations loaded yet.'}
          {filtering && <button type="button" onClick={clearFilters} className="ml-3 rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-200 hover:bg-neutral-800 cursor-pointer">Clear filters</button>}
        </div>
      )}

      {!error && data && data.items.length > 0 && (
        <ul className="divide-y divide-neutral-800 rounded-lg border border-neutral-800" aria-busy={loading}>
          {data.items.map((s) => {
            const fav = favorites.has(s.id);
            const hls = s.streamType === 'hls';
            const where = [s.city, s.region].filter(Boolean).join(', ') || COUNTRY_NAMES[s.country];
            const localTime = localTimeLabel(s.timeZone, now);
            return (
              <li key={s.id} data-station-id={s.id} className="flex items-center gap-3 px-3 py-2.5">
                <div aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-xs font-bold text-neutral-100" style={{ background: tileColor(s.id) }}>{initialsOf(s.name)}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-neutral-100">{s.name}</div>
                  <div className="truncate text-xs text-neutral-400">{s.description ?? COUNTRY_NAMES[s.country]}</div>
                </div>
                <div className="hidden min-w-0 flex-1 truncate text-xs text-neutral-300 sm:block">
                  {where}{localTime && <span className="ml-1 text-neutral-400" data-testid="live-radio-local-time" title={`Local time at the station (${s.timeZone})`}>· {localTime}</span>} <span className="ml-1 text-neutral-500">{s.genres.join(' · ')}</span>
                </div>
                <button type="button" aria-pressed={fav} aria-label={`${fav ? 'Remove' : 'Add'} ${s.name} ${fav ? 'from' : 'to'} favorites`} onClick={() => toggleFavorite(s.id)}
                  className={`h-8 w-8 rounded-full border text-sm cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${fav ? 'border-amber-400/70 text-amber-300' : 'border-neutral-700 text-neutral-400 hover:bg-neutral-800'}`}>{fav ? '♥' : '♡'}</button>
                <button type="button" disabled={hls} onClick={() => play(s)} aria-label={hls ? `${s.name}: HLS streams are not supported yet` : `Play ${s.name}`}
                  title={hls ? 'HLS streams are not supported yet' : `Play ${s.name}`}
                  className={`h-8 w-8 rounded-full text-sm font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${hls ? 'cursor-not-allowed bg-neutral-800 text-neutral-600' : 'cursor-pointer bg-amber-400 text-neutral-950 hover:bg-amber-300'}`}>{hls ? '–' : '▶'}</button>
              </li>
            );
          })}
        </ul>
      )}

      {data && data.total > data.pageSize && (
        <nav aria-label="Pages" className="mt-3 flex items-center justify-center gap-3 text-xs text-neutral-300">
          <button type="button" disabled={data.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded border border-neutral-700 px-2 py-1 hover:bg-neutral-800 disabled:opacity-40 cursor-pointer">Previous</button>
          <span className="tabular-nums">Page {data.page} of {pages}</span>
          <button type="button" disabled={data.page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))} className="rounded border border-neutral-700 px-2 py-1 hover:bg-neutral-800 disabled:opacity-40 cursor-pointer">Next</button>
        </nav>
      )}

      <p className="mt-3 text-[11px] text-neutral-500">Streams were checked by a server-side probe, not a play test: a station that stays silent or errors may be offline. Favorites here are saved in this browser only.</p>
    </section>
  );
}
