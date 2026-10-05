import { useEffect, useState } from 'react';
import { Search, Play, FileVideo, FileAudio, ExternalLink, FolderArchive, ChevronLeft, ChevronRight } from 'lucide-react';
import type { PlayProgramCallback } from '../types';

type Entry = {
  id: string; sourceUrl: string; displayTitle: string; originalTitle: string; genres: string[];
  mediaType: 'video' | 'audio' | 'collection' | 'other'; status: 'playable' | 'not-playable' | 'collection';
  year?: number; creator?: string; thumbnailUrl?: string; reason?: string; episodeCount?: number; playableFileCount?: number;
  memberCount?: number; expanded?: boolean;
  selected?: { path: string; name: string; format: string; durationSeconds?: number; durationEstimated?: boolean };
};
type Result = { page: number; totalPages: number; totalItems: number; generatedAt: string; genres: Array<{ genre: string; count: number }>; items: Entry[] };

const STATUSES = [['playable', 'Playable'], ['not-playable', 'Not playable'], ['collection', 'Collections'], ['all', 'Everything']] as const;
const fmtDur = (s?: number, est?: boolean) => !s || s <= 0 ? '' : `${est ? '~' : ''}${s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.max(1, Math.round(s / 60))} min`}`;

/** Searchable view of the offline @infobattalion catalog snapshot (/api/catalog/items). Read-only. */
export function CatalogPanel({ onPlayProgram }: { onPlayProgram: PlayProgramCallback }) {
  const [query, setQuery] = useState(''); const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState<string>('playable'); const [kind, setKind] = useState(''); const [genre, setGenre] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Result | null>(null); const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null); const [retry, setRetry] = useState(0);

  useEffect(() => { const t = setTimeout(() => setDebounced(query.trim()), 300); return () => clearTimeout(t); }, [query]);
  useEffect(() => { setPage(1); }, [debounced, status, kind, genre]);
  useEffect(() => { setGenre(''); }, [status, kind, debounced]); // genre chips are counted for the current filter, so a stale genre could hide everything

  useEffect(() => {
    const ctrl = new AbortController();
    const p = new URLSearchParams({ page: String(page), limit: '24', status });
    if (debounced) p.set('q', debounced); if (kind) p.set('kind', kind); if (genre) p.set('genre', genre);
    setLoading(true); setError(null);
    fetch(`/api/catalog/items?${p}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { if (e.name !== 'AbortError') { setData(null); setError(e?.message || 'request failed'); setLoading(false); } });
    return () => ctrl.abort();
  }, [page, debounced, status, kind, genre, retry]);

  const play = (e: Entry) => e.selected && onPlayProgram(e.selected.path, e.displayTitle, e.creator ?? e.id, e.mediaType === 'audio' ? 'audio' : 'video', 'catalog', 'library', e.id);
  const chip = (on: boolean) => `rounded-lg px-3 py-1.5 text-xs font-medium ${on ? 'bg-emerald-500 text-neutral-950 font-semibold' : 'border border-neutral-800 bg-neutral-900/60 text-neutral-400 hover:text-neutral-200'}`;

  return (
    <div className="space-y-5 pb-16" data-testid="catalog-panel">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-neutral-400">Your Archive favorites and uploads (@infobattalion), checked offline. Items without a playable file are listed, never hidden.</p>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-neutral-500" aria-hidden="true" />
          <input type="search" id="catalog-filter-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the catalog…" aria-label="Search the catalog"
            className="w-full rounded-xl border border-neutral-800 bg-neutral-900/90 pl-9 pr-3.5 py-2 text-xs text-neutral-100 placeholder-neutral-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Catalog status">
        {STATUSES.map(([v, label]) => <button key={v} type="button" id={`catalog-status-${v}`} aria-pressed={status === v} onClick={() => setStatus(v)} className={chip(status === v)}>{label}</button>)}
        <span className="mx-1 h-5 w-px bg-neutral-800" aria-hidden="true" />
        {[['', 'Any type'], ['video', 'Video'], ['audio', 'Audio']].map(([v, label]) => <button key={v} type="button" id={`catalog-kind-${v || 'any'}`} aria-pressed={kind === v} onClick={() => setKind(v)} className={chip(kind === v)}>{label}</button>)}
      </div>

      {data && data.genres.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Genres">
          {data.genres.map((g) => (
            <button key={g.genre} type="button" aria-pressed={genre === g.genre} onClick={() => setGenre(genre === g.genre ? '' : g.genre)}
              className={`rounded-md border px-2.5 py-1 text-[11px] ${genre === g.genre ? 'border-emerald-400 text-emerald-200' : 'border-neutral-800 text-neutral-300 hover:border-neutral-600'}`}>{g.genre} · {g.count}</button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between text-[11px] text-neutral-500">
        <span aria-live="polite">{loading ? 'Loading…' : data ? `${data.totalItems} ${data.totalItems === 1 ? 'item' : 'items'}` : ''}</span>
        {data && data.totalPages > 1 && (
          <nav aria-label="Catalog pages" className="flex items-center gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page" className="rounded border border-neutral-800 p-1 disabled:opacity-30"><ChevronLeft className="h-3.5 w-3.5" /></button>
            <span>Page {data.page} of {data.totalPages}</span>
            <button type="button" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)} aria-label="Next page" className="rounded border border-neutral-800 p-1 disabled:opacity-30"><ChevronRight className="h-3.5 w-3.5" /></button>
          </nav>
        )}
      </div>

      {error && !loading && (
        <div role="alert" data-testid="catalog-load-error" className="rounded-xl border border-red-900/60 bg-red-950/30 p-6 text-center space-y-2">
          <h3 className="text-sm font-medium text-red-300">The catalog could not be loaded ({error}).</h3>
          <p className="text-xs text-neutral-400">This is a connection or server problem, not an empty result.</p>
          <button type="button" id="catalog-retry-btn" onClick={() => setRetry((n) => n + 1)} className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-700">Try again</button>
        </div>
      )}

      {data && data.items.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.items.map((e) => {
            const isAudio = e.mediaType === 'audio';
            return (
              <div key={e.id} data-testid="catalog-card" className="flex gap-3 rounded-xl border border-neutral-800 bg-neutral-900/50 p-3 hover:border-neutral-700">
                <Poster url={e.thumbnailUrl} />
                <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                      {e.status === 'collection' ? <FolderArchive className="h-3.5 w-3.5" /> : isAudio ? <FileAudio className="h-3.5 w-3.5" /> : <FileVideo className="h-3.5 w-3.5" />}
                      {e.status === 'collection' ? 'Collection' : isAudio ? 'Audio' : e.mediaType === 'video' ? 'Video' : 'Other'}{e.year ? ` · ${e.year}` : ''}
                    </span>
                    <h2 className="text-sm font-semibold text-neutral-100 line-clamp-2">{e.displayTitle}</h2>
                    <p className="truncate text-[10px] text-neutral-500">{e.genres.join(' · ')}</p>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-neutral-500">
                      {e.status === 'playable' ? (fmtDur(e.selected?.durationSeconds, e.selected?.durationEstimated) || '—') + ((e.episodeCount ?? 0) > 1 ? ` · ${e.episodeCount} files` : '')
                        : e.status === 'collection' ? (e.memberCount !== undefined ? `${e.memberCount} members${e.expanded ? ' · listed' : ' · not expanded'}` : 'Sub-collection')
                        : e.reason ?? 'Not playable'}
                    </span>
                    {e.status === 'playable'
                      ? <button type="button" id={`play-catalog-${e.id}`} onClick={() => play(e)} className="shrink-0 flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"><Play className="h-3 w-3 fill-current" aria-hidden="true" />{isAudio ? 'Listen' : 'Watch'}</button>
                      : <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 flex items-center gap-1 rounded-lg border border-neutral-700 px-2.5 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800">Archive.org <ExternalLink className="h-3 w-3" aria-hidden="true" /></a>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {data && data.items.length === 0 && !loading && <p className="rounded-xl border border-neutral-800 p-8 text-center text-sm text-neutral-400">Nothing matches these filters.</p>}
    </div>
  );
}

function Poster({ url }: { url?: string }) {
  const [bad, setBad] = useState(false);
  return (
    <div className="h-20 w-28 shrink-0 overflow-hidden rounded-lg bg-neutral-800">
      {url && !bad ? <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(true)} className="h-full w-full object-cover" />
        : <div className="flex h-full w-full items-center justify-center text-neutral-600"><FolderArchive className="h-6 w-6" aria-hidden="true" /></div>}
    </div>
  );
}
