import { useEffect, useMemo, useState } from 'react';
import { FolderArchive, Search, Play, FileVideo, FileAudio, Clock, Star, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import type { PlayProgramCallback } from '../types';
import { loadFavorites, saveFavorites } from '../utils/favoritesStore';

interface LibraryViewProps { onPlayProgram: PlayProgramCallback }

type Item = {
  type: 'item'; id: string; identifier: string; title: string; description?: string; categoryIds: string[]; mediaType: 'video' | 'audio';
  year?: number; decade?: number; path: string; format: string; dur: number; durSrc: string; durEst: boolean;
  availability: string; channelId?: string; guideId?: string; programId?: string; sourceId?: string; assetId?: string;
};
type Series = {
  type: 'series'; id: string; groupKey: string; title: string; categoryIds: string[]; mediaType: 'video' | 'audio';
  episodeCount: number; episodes: Array<Item & { episodeTitle: string; season?: number; episode?: number }>;
};
type LibraryResult = Item | Series;
type HeatCat = { categoryId: string; label: string; mediaType: string; total: number; decades: Array<{ decade: number; count: number }> };
type Page = { page: number; totalPages: number; totalItems: number; rawCount?: number; uniqueCount?: number; groupCount?: number; items: LibraryResult[] };

const PAGE_SIZE = 24;
const fmtDur = (s: number, est: boolean) => !(s > 0) ? '' : `${est ? '~' : ''}${s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.max(1, Math.round(s / 60))} min`}`;
const decadeLabel = (d: number) => (d === 0 ? 'Undated' : `${d}s`);

/** Library: categories and decade counts come from the server index; items arrive one page at a time. */
export function LibraryView({ onPlayProgram }: LibraryViewProps) {
  const [heat, setHeat] = useState<HeatCat[] | null>(null);
  const [heatError, setHeatError] = useState<string | null>(null);
  // Opened from a shortcut (e.g. Home's "Apollo Mission Archive"): start on that category once.
  const [category, setCategory] = useState<string>(() => { try { const c = sessionStorage.getItem('ajn.library.open') ?? ''; sessionStorage.removeItem('ajn.library.open'); return c; } catch { return ''; } });
  const [decade, setDecade] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);
  const [loading, setLoading] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => loadFavorites());
  const [showFavorites, setShowFavorites] = useState(false);
  const [openSeries, setOpenSeries] = useState<Set<string>>(() => new Set());

  useEffect(() => { saveFavorites(favoriteIds); }, [favoriteIds]);
  useEffect(() => { const t = setTimeout(() => setDebounced(query.trim()), 300); return () => clearTimeout(t); }, [query]);
  useEffect(() => { setPage(1); }, [category, decade, debounced, showFavorites]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/api/library/heatmap', { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setHeat(d.categories))
      .catch((e) => { if (e.name !== 'AbortError') setHeatError(e.message); });
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    const p = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (showFavorites) p.set('ids', [...favoriteIds].join(','));
    else {
      if (category) p.set('category', category);
      if (decade !== null) p.set('decade', String(decade));
      if (debounced) p.set('q', debounced);
    }
    if (showFavorites && favoriteIds.size === 0) { setData({ page: 1, totalPages: 1, totalItems: 0, items: [] }); return; }
    setLoading(true);
    fetch(`/api/library/items?${p}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { if (e.name !== 'AbortError') { setData({ page: 1, totalPages: 1, totalItems: 0, items: [] }); setLoading(false); } });
    return () => ctrl.abort();
    // favorites only matter for the Favorites view
  }, [page, category, decade, debounced, showFavorites, showFavorites ? favoriteIds : null]);

  const cat = useMemo(() => heat?.find((c) => c.categoryId === category) ?? null, [heat, category]);
  const allTotal = useMemo(() => heat ? heat.reduce((n, c) => n + c.total, 0) : 0, [heat]);
  const maxDecade = Math.max(1, ...(cat?.decades.map((d) => d.count) ?? [1]));

  const toggleFavorite = (id: string) => setFavoriteIds((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const play = (it: Item) => onPlayProgram(it.path, it.title, it.description ?? it.identifier, it.mediaType, it.channelId ?? `library-${it.categoryIds[0]}`, it.guideId ?? 'library', it.programId ?? it.id, it.sourceId, it.assetId);
  const toggleSeries = (id: string) => setOpenSeries((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-6 pb-16">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-neutral-800 pb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"><FolderArchive className="h-4 w-4" /></div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-neutral-50">Media Archive Library</h1>
          </div>
          <p className="text-xs text-neutral-400">Films, shows, radio and audiobooks from the Internet Archive — each with a checked, playable file.</p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-neutral-500" aria-hidden="true" />
          <input type="search" id="library-filter-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the library…" aria-label="Search the library"
            className="w-full rounded-xl border border-neutral-800 bg-neutral-900/90 pl-9 pr-3.5 py-2 text-xs text-neutral-100 placeholder-neutral-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
        </div>
      </div>

      {heatError && <p role="alert" className="text-xs text-red-400">Library index unavailable ({heatError}).</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" id="lib-cat-btn-all" onClick={() => { setCategory(''); setDecade(null); setShowFavorites(false); }}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium ${!category && !showFavorites ? 'bg-emerald-500 text-neutral-950 font-semibold' : 'border border-neutral-800 bg-neutral-900/60 text-neutral-400 hover:text-neutral-200'}`}>
          All {heat ? `(${allTotal})` : ''}
        </button>
        {heat?.map((c) => (
          <button key={c.categoryId} type="button" id={`lib-cat-btn-${c.categoryId}`} disabled={c.total === 0}
            onClick={() => { setCategory(c.categoryId); setDecade(null); setShowFavorites(false); }}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40 ${category === c.categoryId && !showFavorites ? 'bg-emerald-500 text-neutral-950 font-semibold' : 'border border-neutral-800 bg-neutral-900/60 text-neutral-400 hover:text-neutral-200'}`}>
            {c.label} ({c.total})
          </button>
        ))}
        <button type="button" id="lib-favorites-btn" aria-pressed={showFavorites} onClick={() => setShowFavorites((v) => !v)}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${showFavorites ? 'bg-amber-400 text-neutral-950 font-semibold' : 'border border-neutral-800 bg-neutral-900/60 text-neutral-400 hover:text-neutral-200'}`}>
          <Star className={`h-3.5 w-3.5 ${showFavorites ? 'fill-current' : ''}`} aria-hidden="true" /> Favorites ({favoriteIds.size})
        </button>
      </div>

      {cat && !showFavorites && cat.decades.length > 0 && (
        <div className="space-y-1.5" data-testid="decade-strip">
          <div className="flex items-center justify-between text-[11px] text-neutral-500"><span>Items per decade — pick one to narrow the list</span>
            {decade !== null && <button type="button" onClick={() => setDecade(null)} className="text-emerald-400 hover:underline">Show all decades</button>}</div>
          <div className="flex flex-wrap gap-1.5">
            {cat.decades.map((d) => (
              <button key={d.decade} type="button" onClick={() => setDecade(decade === d.decade ? null : d.decade)} aria-pressed={decade === d.decade}
                title={`${decadeLabel(d.decade)}: ${d.count} items`}
                className={`relative overflow-hidden rounded-md border px-2.5 py-1 text-[11px] ${decade === d.decade ? 'border-emerald-400 text-emerald-200' : 'border-neutral-800 text-neutral-300 hover:border-neutral-600'}`}>
                <span aria-hidden="true" className="absolute inset-0 bg-emerald-500" style={{ opacity: 0.08 + 0.4 * (d.count / maxDecade) }} />
                <span className="relative">{decadeLabel(d.decade)} · {d.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between text-[11px] text-neutral-500">
        <span aria-live="polite">{loading ? 'Loading…' : data ? `${data.totalItems} ${data.totalItems === 1 ? 'item' : 'items'}` : ''}</span>
        {data && data.totalPages > 1 && <Pager page={data.page} total={data.totalPages} onPage={setPage} />}
      </div>

      {data && data.items.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.items.map((item) => {
            if (item.type === 'series') {
              const open = openSeries.has(item.id);
              const isAudio = item.mediaType === 'audio';
              return (
                <div key={item.id} className="group flex flex-col rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 transition hover:border-neutral-700 hover:bg-neutral-900">
                  <button type="button" onClick={() => toggleSeries(item.id)} aria-expanded={open} className="w-full text-left">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">{isAudio ? <FileAudio className="h-3.5 w-3.5" /> : <FileVideo className="h-3.5 w-3.5" />}{isAudio ? 'Audio' : 'Series'}</span>
                      <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                    </div>
                    <h2 className="mt-2 text-sm font-semibold text-neutral-100 line-clamp-2">{item.title}</h2>
                    <p className="mt-1 text-xs text-emerald-400">Episodes: {item.episodeCount}</p>
                  </button>
                  {open && <div className="mt-3 space-y-2 border-t border-neutral-800 pt-3">
                    {item.episodes.map((ep) => (
                      <div key={ep.identifier} className="flex items-center justify-between gap-3 rounded-lg bg-neutral-950/60 p-2.5">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-medium text-neutral-200">{ep.episodeTitle}</div>
                          <div className="text-[10px] text-neutral-500">{ep.year ?? 'Archive'}{ep.availability === 'verified' ? ' · checked' : ''}</div>
                        </div>
                        <button type="button" id={`play-lib-episode-${ep.id}`} onClick={() => play(ep)} className="shrink-0 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-500">
                          <Play className="mr-1 inline h-3 w-3 fill-current" />{isAudio ? 'Listen' : 'Watch'}
                        </button>
                      </div>
                    ))}
                  </div>}
                </div>
              );
            }
            const isAudio = item.mediaType === 'audio';
            const fav = favoriteIds.has(item.id);
            return (
              <div key={item.id} className="group flex flex-col justify-between rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 transition hover:border-neutral-700 hover:bg-neutral-900">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">{isAudio ? <FileAudio className="h-3.5 w-3.5" /> : <FileVideo className="h-3.5 w-3.5" />}{isAudio ? 'Audio' : 'Video'}{item.format && item.format !== 'none' ? ` · ${item.format}` : ''}</span>
                    <span className="flex items-center gap-1">
                      <span className="rounded bg-neutral-800 px-2 py-0.5 font-mono text-[10px] text-neutral-300">{item.year ?? 'Archive'}</span>
                      <button type="button" id={`favorite-lib-item-${item.id}`} aria-pressed={fav} aria-label={fav ? `Remove ${item.title} from favorites` : `Add ${item.title} to favorites`} onClick={() => toggleFavorite(item.id)} className="rounded-md p-1 text-neutral-500 hover:bg-neutral-800 hover:text-amber-400">
                        <Star className={`h-4 w-4 ${fav ? 'fill-current text-amber-400' : ''}`} aria-hidden="true" />
                      </button>
                    </span>
                  </div>
                  <h2 className="text-sm font-semibold text-neutral-100 line-clamp-2">{item.title}</h2>
                  {item.description && <p className="text-xs text-neutral-400 line-clamp-3 leading-relaxed">{item.description}</p>}
                </div>
                <div className="mt-4 pt-3 border-t border-neutral-800 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs text-neutral-500" title={item.durEst ? 'Estimated length' : undefined}><Clock className="h-3.5 w-3.5" aria-hidden="true" />{fmtDur(item.dur, item.durEst) || '—'}{item.availability === 'verified' ? ' · checked' : ''}</span>
                  <button type="button" id={`play-lib-item-${item.id}`} onClick={() => play(item)} className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">
                    <Play className="h-3 w-3 fill-current" aria-hidden="true" />{isAudio ? 'Listen' : 'Watch'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : !loading && data ? (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-10 text-center space-y-2">
          <FolderArchive className="mx-auto h-8 w-8 text-neutral-600" aria-hidden="true" />
          <h3 className="text-sm font-medium text-neutral-300">{showFavorites ? 'No favorites yet' : 'Nothing matches'}</h3>
          <button type="button" onClick={() => { setCategory(''); setDecade(null); setQuery(''); setShowFavorites(false); }} className="mt-2 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-700">Clear filters</button>
        </div>
      ) : null}

      {data && data.totalPages > 1 && <div className="flex justify-center"><Pager page={data.page} total={data.totalPages} onPage={setPage} /></div>}
    </div>
  );
}

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  return (
    <nav aria-label="Library pages" className="flex items-center gap-2 text-xs text-neutral-400">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page" className="rounded border border-neutral-800 p-1 disabled:opacity-30 hover:border-neutral-600"><ChevronLeft className="h-3.5 w-3.5" /></button>
      <span>Page {page} of {total}</span>
      <button type="button" disabled={page >= total} onClick={() => onPage(page + 1)} aria-label="Next page" className="rounded border border-neutral-800 p-1 disabled:opacity-30 hover:border-neutral-600"><ChevronRight className="h-3.5 w-3.5" /></button>
    </nav>
  );
}
