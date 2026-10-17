import { useRadioFavorites, toggleRadioFavorite } from '../utils/radioFavorites';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { PlayProgramCallback } from '../types';
import { registerLiveRadioMeter } from '../utils/mediaRoute';

export interface LiveRadioItem {
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
  /** Stable station number: type #123 in the search box to find it. */
  number?: number;
  logo?: string;
  corsVerified?: boolean;
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
  vizTotal: number;
}

const COUNTRY_NAMES: Record<'US' | 'CA', string> = { US: 'United States', CA: 'Canada' };
/** One screenful: 12 tiles on desktop (6 x 2), 9 on a phone (3 x 3). Never a page-long list. */
function pageSizeFor(compact: boolean, wide: boolean): number {
  if (compact && wide) return typeof window !== 'undefined' && window.innerWidth < 640 ? 12 : 30; // full-screen Radio: many stations at once
  if (compact) return 9; // 3 x 3 inside the small Radio dock
  return typeof window !== 'undefined' && window.innerWidth < 640 ? 9 : 12;
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

/** Station picture: the station's own logo when it loads, otherwise an honest initials tile. Never a stock or invented image. */
function StationArt({ s, size, broken, onBroken }: { s: LiveRadioItem; size: number; broken: boolean; onBroken: (id: string) => void }): ReactElement {
  const style = { width: size, height: size };
  if (s.logo && !broken) {
    return (
      <img src={s.logo} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} style={style}
        className="shrink-0 rounded-lg bg-neutral-900 object-contain"
        onError={() => onBroken(s.id)}
        onLoad={(e) => { if (e.currentTarget.naturalWidth < 24) onBroken(s.id); }} />
    );
  }
  return (
    <div aria-hidden="true" style={{ ...style, background: tileColor(s.id) }}
      className="flex shrink-0 items-center justify-center rounded-lg text-sm font-bold text-neutral-100">{initialsOf(s.name)}</div>
  );
}

export function LiveRadioDirectory({ onPlay, onTuned, compact = false, wide = false, activeId }: {
  onPlay: PlayProgramCallback;
  /** Called with the full station record when one is played (the Radio dock shows its picture). */
  onTuned?: (s: LiveRadioItem) => void;
  /** Small-panel layout for the Radio dock: 3-across tiles, no outer card, no "selected" strip. */
  compact?: boolean;
  /** With compact: the Radio dock is full screen, so show more columns and more stations per page. */
  wide?: boolean;
  /** Station currently playing (highlighted tile). */
  activeId?: string;
}): ReactElement {
  const PAGE_SIZE = pageSizeFor(compact, wide);
  const [query, setQuery] = useState<string>('');
  const [debounced, setDebounced] = useState<string>('');
  const [country, setCountry] = useState<string>('');
  const [genre, setGenre] = useState<string>('');
  const [region, setRegion] = useState<string>('');
  const [city, setCity] = useState<string>('');
  const [now, setNow] = useState<number>(() => Date.now());
  const [favoritesOnly, setFavoritesOnly] = useState<boolean>(false);
  const [vizOnly, setVizOnly] = useState<boolean>(false);
  const favorites = useRadioFavorites();
  const [page, setPage] = useState<number>(1);
  const [data, setData] = useState<LiveRadioPageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [reloadKey, setReloadKey] = useState<number>(0);
  const [selected, setSelected] = useState<LiveRadioItem | null>(null);
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  const facets = useRef<{ countries: Array<'US' | 'CA'>; genres: string[]; vizTotal: number }>({ countries: [], genres: [], vizTotal: 0 });

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => { setPage(1); }, [debounced, country, region, city, genre, favoritesOnly, vizOnly, PAGE_SIZE]);

  const favoriteIds = [...favorites].join(',');
  useEffect(() => {
    // Favorites-only with no favorites is an empty list, not "every station".
    if (favoritesOnly && favorites.size === 0) {
      setData({ total: 0, page: 1, pageSize: PAGE_SIZE, items: [], countries: facets.current.countries, genres: facets.current.genres, regions: [], cities: [], vizTotal: facets.current.vizTotal });
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
    if (vizOnly) params.set('viz', '1');
    if (favoritesOnly) params.set('ids', favoriteIds);
    setLoading(true);
    fetch(`/api/live-radio/stations?${params.toString()}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<LiveRadioPageResponse>;
      })
      .then((json) => {
        facets.current = { countries: json.countries, genres: json.genres, vizTotal: json.vizTotal ?? 0 };
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
  }, [page, debounced, country, region, city, genre, vizOnly, favoritesOnly, favoriteIds, favorites.size, reloadKey, PAGE_SIZE]);

  const toggleFavorite = useCallback((id: string) => { toggleRadioFavorite(id); }, []);

  const markBroken = useCallback((id: string) => {
    setBroken((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  const clearFilters = useCallback(() => {
    setQuery(''); setDebounced(''); setCountry(''); setRegion(''); setCity(''); setGenre(''); setFavoritesOnly(false); setVizOnly(false);
  }, []);

  const play = (s: LiveRadioItem): void => {
    const where = [s.city, s.region].filter(Boolean).join(', ');
    // The server said this stream sends CORS headers: let the player load it in CORS mode so the visualizer can read it.
    if (s.corsVerified) registerLiveRadioMeter(s.id);
    setSelected(s);
    onTuned?.(s);
    onPlay(s.streamUrl, s.name, where || COUNTRY_NAMES[s.country], 'audio', s.id, 'audio-podcasts', s.programId);
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtering = Boolean(debounced || country || region || city || genre || favoritesOnly || vizOnly);
  const field = 'rounded-lg border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-xs text-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400';
  const chip = (on: boolean): string => `shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
    on ? 'border-amber-400/60 bg-amber-500/20 text-amber-100' : 'border-neutral-700 text-neutral-300 hover:bg-neutral-800'}`;
  const selLocal = selected ? localTimeLabel(selected.timeZone, now) : null;

  return (
    <section id="live-radio-directory" aria-label="Live radio" data-testid="live-radio-directory"
      className={compact ? '' : 'overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950/70 shadow-2xl'}>
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-3 py-2">
        <div className={compact ? 'mr-auto' : 'mr-auto'}>
          {!compact && <p className="text-[10px] font-mono uppercase tracking-widest text-amber-400/80">Live Radio · US + Canada</p>}
          <p className="text-sm font-semibold text-neutral-100">
            Stations <span className="font-normal text-neutral-500" data-testid="live-radio-count">({data ? data.total : '…'})</span>
          </p>
        </div>
        <button type="button" aria-pressed={vizOnly} onClick={() => setVizOnly((v) => !v)} data-testid="live-radio-viz-toggle"
          title="Only stations whose stream allows the audio visualizer"
          className={chip(vizOnly)}>▮▮ Visualizer ready <b className="tabular-nums">{facets.current.vizTotal || ''}</b></button>
        <button type="button" aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly((v) => !v)} className={chip(favoritesOnly)}>
          ♥ Favorites <b className="tabular-nums">{favorites.size}</b>
        </button>
      </div>

      <div className={`grid grid-cols-2 gap-2 px-3 pt-3 ${compact && !wide ? '' : 'sm:grid-cols-[minmax(0,1fr)_9rem_9rem_9rem]'}`}>
        <label className={compact && !wide ? 'col-span-2' : 'col-span-2 sm:col-span-1'}>
          <span className="sr-only">Search stations</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search stations, cities, genres, or #number..." autoComplete="off"
            data-testid="live-radio-search" className={`${field} w-full placeholder:text-neutral-500`} />
        </label>
        <label>
          <span className="sr-only">Filter by country</span>
          <select value={country} onChange={(e) => { setCountry(e.target.value); setRegion(''); setCity(''); }} data-testid="live-radio-country" className={`${field} w-full`}>
            <option value="">All countries</option>
            {facets.current.countries.map((c) => <option key={c} value={c}>{COUNTRY_NAMES[c]}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">Filter by province or state</span>
          <select value={region} onChange={(e) => { setRegion(e.target.value); setCity(''); }} data-testid="live-radio-region" className={`${field} w-full`}>
            <option value="">{country === 'CA' ? 'All provinces' : country === 'US' ? 'All states' : 'State / province'}</option>
            {(data?.regions ?? []).map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label className={compact && !wide ? 'col-span-2' : 'col-span-2 sm:col-span-1'}>
          <span className="sr-only">Filter by city</span>
          <select value={city} onChange={(e) => setCity(e.target.value)} disabled={!region} data-testid="live-radio-city"
            title={region ? undefined : 'Choose a state or province first'} className={`${field} w-full disabled:opacity-50`}>
            <option value="">{region ? 'All cities' : 'City (pick a state first)'}</option>
            {(data?.cities ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>

      <div role="group" aria-label="Filter by genre" className="flex gap-1.5 overflow-x-auto px-3 py-2 [scrollbar-width:thin] [scrollbar-color:#525252_transparent]">
        {['', ...facets.current.genres].map((g) => (
          <button key={g || 'all'} type="button" aria-pressed={genre === g} onClick={() => setGenre(g)} data-genre={g} className={chip(genre === g)}>
            {g || 'All genres'}
          </button>
        ))}
      </div>

      <div className={`px-3 pb-2 ${compact && !wide ? 'min-h-[12rem]' : 'min-h-[15rem]'}`}>
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
          <ul className={`grid grid-cols-3 gap-2 ${compact && !wide ? '' : 'sm:grid-cols-4 lg:grid-cols-6'}`} aria-busy={loading}>
            {(favoritesOnly ? [...data.items].sort((x, y) => (x.number ?? 1e9) - (y.number ?? 1e9)) : data.items).map((s) => {
              const fav = favorites.has(s.id);
              const hls = s.streamType === 'hls';
              const where = [s.city, s.region].filter(Boolean).join(', ') || COUNTRY_NAMES[s.country];
              const localTime = localTimeLabel(s.timeZone, now);
              const isSel = (activeId ?? selected?.id) === s.id;
              return (
                <li key={s.id} data-station-id={s.id}
                  className={`relative flex flex-col items-center gap-1 rounded-lg border p-2 text-center ${isSel ? 'border-amber-400/70 bg-amber-500/10' : 'border-neutral-800 bg-neutral-900/50 hover:bg-neutral-900'}`}>
                  <button type="button" disabled={hls} onClick={() => play(s)}
                    aria-label={hls ? `${s.name}: HLS streams are not supported yet` : `Play ${s.name}${s.number ? `, station ${s.number}` : ''}`}
                    title={hls ? 'HLS streams are not supported yet' : `Play ${s.name} — ${where}`}
                    className={`flex w-full flex-col items-center gap-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${hls ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
                    <StationArt s={s} size={52} broken={broken.has(s.id)} onBroken={markBroken} />
                    <span className="line-clamp-2 w-full break-words text-[11px] font-semibold leading-tight text-neutral-100">{s.name}</span>
                    <span className="w-full truncate text-[10px] text-neutral-400">{where}</span>
                    {s.number ? <span data-testid="live-radio-number" title="Station number: type #" className="text-[10px] font-semibold tabular-nums text-amber-300/80">#{s.number}</span> : null}
                    {localTime && <span className="text-[10px] text-neutral-500" data-testid="live-radio-local-time" title={`Local time at the station (${s.timeZone})`}>{localTime}</span>}
                  </button>
                  {s.corsVerified && <span title="Audio visualizer available" aria-label="Visualizer available" className="absolute left-1.5 top-1.5 rounded bg-sky-500/20 px-1 text-[9px] font-bold text-sky-300">▮▮</span>}
                  <button type="button" aria-pressed={fav} aria-label={`${fav ? 'Remove' : 'Add'} ${s.name} ${fav ? 'from' : 'to'} favorites`} onClick={() => toggleFavorite(s.id)}
                    className={`absolute right-1 top-1 h-6 w-6 rounded-full text-xs cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${fav ? 'text-amber-300' : 'text-neutral-500 hover:text-neutral-200'}`}>{fav ? '♥' : '♡'}</button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-neutral-800 px-3 py-1.5 text-xs text-neutral-300">
        <span className="text-[11px] text-neutral-500">{compact ? 'A silent station may be offline.' : 'Checked by a server probe, not a play test: a silent station may be offline.'}</span>
        {data && data.total > data.pageSize && (
          <nav aria-label="Pages" className="flex items-center gap-2">
            <button type="button" disabled={data.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label="Previous page" className="rounded border border-neutral-700 px-2 py-0.5 hover:bg-neutral-800 disabled:opacity-40 cursor-pointer">‹</button>
            <span className="tabular-nums">{data.page} / {pages}</span>
            <button type="button" disabled={data.page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))} aria-label="Next page" className="rounded border border-neutral-700 px-2 py-0.5 hover:bg-neutral-800 disabled:opacity-40 cursor-pointer">›</button>
          </nav>
        )}
      </div>

      {!compact && <div role="status" data-testid="live-radio-now" className="flex items-center gap-3 border-t border-neutral-800 bg-neutral-900/60 px-3 py-2">
        {selected ? (
          <>
            <StationArt s={selected} size={40} broken={broken.has(selected.id)} onBroken={markBroken} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-neutral-100">{selected.name}</div>
              <div className="truncate text-xs text-neutral-400">
                {[selected.city, selected.region].filter(Boolean).join(', ') || COUNTRY_NAMES[selected.country]}{selLocal ? ` · ${selLocal}` : ''}
              </div>
            </div>
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${selected.corsVerified ? 'border-sky-500/50 bg-sky-500/10 text-sky-200' : 'border-neutral-700 text-neutral-400'}`}
              title={selected.corsVerified ? 'This stream allows the visualizer. Switch it on with the visualizer button in the player.' : 'This stream does not send CORS headers, so the browser cannot read it for the visualizer. Sound is unaffected.'}>
              {selected.corsVerified ? '▮▮ Visualizer ready' : 'No visualizer for this station'}
            </span>
          </>
        ) : (
          <p className="text-xs text-neutral-500">Pick a station. Stations marked ▮▮ can drive the audio visualizer.</p>
        )}
      </div>}
    </section>
  );
}
