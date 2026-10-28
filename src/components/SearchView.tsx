import { bufferGaugeMetadata } from '../utils/bufferGauge';
import React, { useState, useEffect, useCallback, useMemo, FormEvent } from 'react';
import {
  Search,
  Tv,
  Play,
  Calendar,
  Clock,
  Filter,
  RefreshCw,
  AlertCircle,
  FileText,
  Sparkles,
} from 'lucide-react';
import type { TVNewsItem } from '../../channels';
import { PlayProgramCallback } from '../types';
import { highlightParts, nextActiveIndex, SUGGEST_MIN_CHARS, suggest, type SuggestCandidate } from '../utils/suggest';
import { buildEmptySearchSuggestionGroups } from '../utils/searchSuggestions';
import { searchScrollBehavior, shouldScrollResults } from '../utils/searchScroll';

interface SearchViewProps {
  onPlayProgram: PlayProgramCallback;
  /** Query submitted from the header search; `n` changes on every submit so repeats re-run. */
  externalQuery?: { q: string; n: number };
  suggestions?: SuggestCandidate[];
  onRecordSearch?: (q: string) => void;
  onClearRecentSearches?: () => void;
}

const NETWORKS = [
  { id: 'FOXNEWSW', name: 'Fox News' },
  { id: 'CNNW', name: 'CNN' },
  { id: 'MSNBCW', name: 'MSNBC' },
];

const SUGGESTIONS = [
  'Election',
  'Economy',
  'Congress',
  'Space',
  'Foreign Policy',
  'Briefing',
  'Supreme Court',
  'Technology',
];

const SUGGESTION_KIND_LABEL: Record<string, string> = { recent: 'Recent', history: 'Watched', favorite: 'Favorite', topic: 'Topic' };

export function SearchView({ onPlayProgram, externalQuery, suggestions = [], onRecordSearch, onClearRecentSearches }: SearchViewProps) {
    const [buildStatus, setBuildStatus] = useState<string>('');
  const [builtAssets, setBuiltAssets] = useState<any[]>([]);

  const [built, setBuilt] = useState<{ channelId: string; guideId: string; name: string; clips: number; items: number; skipped: Array<{ identifier: string; reason: string }> } | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  // Build from the recordings on screen (not a new free-text search), as clips the
  // news guide already plays; the server keeps it as a real channel so playback
  // continues item after item.
  const handleBuildChannel = async () => {
    setBuildStatus('building'); setBuildError(null);
    try {
      const network = NETWORKS.find((n) => n.id === selectedNetwork)?.name ?? selectedNetwork;
      const res = await fetch('/api/channels/build-news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifiers: items.map((i) => i.identifier),
          titles: Object.fromEntries(items.map((i) => [i.identifier, i.title])),
          network: selectedNetwork,
          name: query ? `${network}: ${query}` : `${network} 24/7`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setBuiltAssets(data.programs || []);
      setBuilt({ channelId: data.channelId, guideId: data.guideId, name: data.name, clips: data.clips, items: data.items, skipped: data.skipped || [] });
      setBuildStatus('done');
    } catch (e) {
      setBuildError(e instanceof Error ? e.message : String(e));
      setBuildStatus('error');
    }
  };
const [query, setQuery] = useState<string>('');
  const [selectedNetwork, setSelectedNetwork] = useState<string>('FOXNEWSW');
  const [loading, setLoading] = useState<boolean>(false);
  const [items, setItems] = useState<TVNewsItem[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState<boolean>(false);
  const [lastQuery, setLastQuery] = useState<string>('');
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);

  const searchSeqRef = React.useRef(0);
  const searchAbortRef = React.useRef<AbortController | null>(null);
  const pendingAutoScrollSeqRef = React.useRef<number | null>(null);
  const searchRegionRef = React.useRef<HTMLElement | null>(null);
  const searchHeadingRef = React.useRef<HTMLHeadingElement | null>(null);
  const suggestionUid = React.useId();
  const suggestionListId = `${suggestionUid}-list`;
  const emptySuggestionGroups = useMemo(() => buildEmptySearchSuggestionGroups(suggestions), [suggestions]);
  const typedSuggestions = useMemo(() => suggest(query, suggestions), [query, suggestions]);
  const isEmptyQuery = query.trim().length === 0;
  const emptySuggestionItems = [...emptySuggestionGroups.recent, ...emptySuggestionGroups.topics];
  const visibleSuggestionItems = isEmptyQuery ? emptySuggestionItems : typedSuggestions;
  const showSuggestions = suggestionsOpen && visibleSuggestionItems.length > 0;

  const executeSearch = useCallback(
    async (searchTerm: string, network: string, userInitiated = false) => {
      const seq = ++searchSeqRef.current;
      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;
      pendingAutoScrollSeqRef.current = userInitiated ? seq : null;
      setLoading(true);
      setError(null);
      setHasSearched(true);
      try {
        const url = `/api/search?network=${encodeURIComponent(network)}&q=${encodeURIComponent(searchTerm)}&rows=24`;
        const res = await fetch(url, { signal: controller.signal });
        const data = await res.json();
        if (seq !== searchSeqRef.current) return;
        if (!res.ok) {
          if (res.status === 502 && data?.status === 'upstream_error') {
            throw new Error(data.error || 'Archive search is temporarily unavailable. Please retry.');
          }
          throw new Error(data?.error || `Search failed: HTTP ${res.status}`);
        }
        setItems(Array.isArray(data.items) ? data.items : []);
        setTotal(data.total || 0);
        setLastQuery(searchTerm);
      } catch (err: any) {
        if (seq !== searchSeqRef.current || err?.name === 'AbortError') return;
        setError(err.message || 'An error occurred while querying the archive');
        setItems([]);
        setTotal(0);
      } finally {
        if (seq === searchSeqRef.current) setLoading(false);
      }
    },
    []
  );

  // Initial search on mount
  const firstRunRef = React.useRef(true);
  useEffect(() => {
    const first = firstRunRef.current;
    firstRunRef.current = false;
    // The header search effect below owns the first load when a query was submitted.
    if (first && externalQuery && externalQuery.n > 0) return;
    executeSearch('', selectedNetwork);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executeSearch]);

  // A search typed into the header runs here, replacing the mount-time empty search.
  useEffect(() => {
    if (!externalQuery || externalQuery.n === 0) return;
    setQuery(externalQuery.q);
    executeSearch(externalQuery.q, selectedNetwork, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalQuery?.n]);

  // Scroll only after the current user-initiated request has rendered its final state.
  useEffect(() => {
    const seq = pendingAutoScrollSeqRef.current;
    if (seq === null || loading || seq !== searchSeqRef.current || !hasSearched) return;
    const region = searchRegionRef.current;
    if (!region) {
      pendingAutoScrollSeqRef.current = null;
      return;
    }

    const stickyHeaderHeight = document.getElementById('canonical-app-header')?.getBoundingClientRect().height ?? 0;
    region.style.scrollMarginTop = `${Math.ceil(Math.max(0, stickyHeaderHeight) + 8)}px`;
    const resultsTop = region.getBoundingClientRect().top;
    if (shouldScrollResults(resultsTop, window.innerHeight, stickyHeaderHeight)) {
      region.scrollIntoView({
        block: 'start',
        behavior: searchScrollBehavior(window.matchMedia('(prefers-reduced-motion: reduce)').matches),
      });
    }
    searchHeadingRef.current?.focus({ preventScroll: true });
    pendingAutoScrollSeqRef.current = null;
  }, [loading, error, items, total, lastQuery, hasSearched]);

  useEffect(() => {
    if (!showSuggestions || activeSuggestionIndex < 0) return;
    const option = document.getElementById(`${suggestionUid}-option-${activeSuggestionIndex}`);
    const box = document.querySelector<HTMLElement>('[data-testid="search-suggest-dropdown"]');
    if (!option || !box) return;
    if (option.offsetTop < box.scrollTop) box.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = option.offsetTop + option.offsetHeight - box.clientHeight;
  }, [activeSuggestionIndex, showSuggestions, suggestionUid]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onRecordSearch?.(query);
    setSuggestionsOpen(false);
    executeSearch(query, selectedNetwork, true);
  };

  const pickSuggestion = (text: string) => {
    setQuery(text);
    setSuggestionsOpen(false);
    setActiveSuggestionIndex(-1);
    onRecordSearch?.(text);
    executeSearch(text, selectedNetwork, true);
  };

  const renderSuggestionOption = (item: SuggestCandidate, index: number, emphasize: boolean) => (
    <div
      key={`${item.text}-${index}`}
      id={`${suggestionUid}-option-${index}`}
      role="option"
      aria-selected={index === activeSuggestionIndex}
      data-testid="search-suggest-option"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => pickSuggestion(item.text)}
      onMouseEnter={() => setActiveSuggestionIndex(index)}
      className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm ${index === activeSuggestionIndex ? 'bg-sky-500/20 text-white' : 'text-neutral-200'}`}
    >
      <span className="min-w-0 truncate">
        {emphasize
          ? highlightParts(item.text, query).map((part, partIndex) => part.match
            ? <mark key={partIndex} className="rounded-sm bg-transparent font-bold text-sky-300 underline decoration-sky-400/60 underline-offset-2">{part.text}</mark>
            : <span key={partIndex}>{part.text}</span>)
          : item.text}
      </span>
      {item.kind && <span className="shrink-0 text-[10px] uppercase tracking-wider text-neutral-500">{SUGGESTION_KIND_LABEL[item.kind]}</span>}
    </div>
  );

  return (
    <div className="space-y-8 pb-16">
      {/* ── Search Header & Description ──────────────────────────────────── */}
      <div className="space-y-1 border-b border-neutral-800 pb-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <Search className="h-4 w-4" />
          </div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-neutral-50">
            Internet Archive TV News Search
          </h1>
        </div>
        <p className="text-xs text-neutral-400">
          Query thousands of broadcast news segments across major national television networks with closed-caption indexing.
        </p>
      </div>

      {/* ── Search Input & Network Filters ───────────────────────────────── */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5 backdrop-blur space-y-4">
        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-3 h-4 w-4 text-neutral-400" />
            <input
              id="tvnews-search-input"
              type="text"
              role="combobox"
              aria-label="Search broadcast topics"
              aria-autocomplete="list"
              aria-expanded={showSuggestions}
              aria-controls={suggestionListId}
              aria-activedescendant={showSuggestions && activeSuggestionIndex >= 0 ? `${suggestionUid}-option-${activeSuggestionIndex}` : undefined}
              autoComplete="off"
              value={query}
              placeholder="Search broadcast topics, speakers, or events..."
              className="w-full rounded-xl border border-neutral-700 bg-neutral-950 pl-10 pr-4 py-2.5 text-sm text-neutral-100 placeholder-neutral-500 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
              onChange={(event) => {
                const nextQuery = event.target.value;
                setQuery(nextQuery);
                setActiveSuggestionIndex(-1);
                setSuggestionsOpen(nextQuery.trim().length === 0
                  ? emptySuggestionItems.length > 0
                  : nextQuery.trim().length >= SUGGEST_MIN_CHARS);
              }}
              onFocus={() => {
                setSuggestionsOpen(isEmptyQuery
                  ? emptySuggestionItems.length > 0
                  : query.trim().length >= SUGGEST_MIN_CHARS);
              }}
              onBlur={() => {
                setSuggestionsOpen(false);
                setActiveSuggestionIndex(-1);
              }}
              onKeyDown={(event) => {
                if (showSuggestions) {
                  const next = nextActiveIndex(event.key, activeSuggestionIndex, visibleSuggestionItems.length);
                  if (next !== null) {
                    event.preventDefault();
                    setActiveSuggestionIndex(next);
                    return;
                  }
                  if (event.key === 'Enter' && activeSuggestionIndex >= 0) {
                    event.preventDefault();
                    pickSuggestion(visibleSuggestionItems[activeSuggestionIndex].text);
                    return;
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    setSuggestionsOpen(false);
                    setActiveSuggestionIndex(-1);
                    return;
                  }
                } else if (event.key === 'ArrowDown' && visibleSuggestionItems.length > 0) {
                  event.preventDefault();
                  setSuggestionsOpen(true);
                  setActiveSuggestionIndex(0);
                }
              }}
            />
            {showSuggestions && (
              <div
                data-testid="search-suggest-dropdown"
                className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-auto rounded-xl border border-neutral-700 bg-neutral-950/98 p-1 shadow-xl backdrop-blur-md"
              >
                {isEmptyQuery && emptySuggestionGroups.recent.length > 0 && (
                  <div className="flex items-center justify-end px-2 py-1">
                    <button
                      type="button"
                      data-testid="clear-recent-searches"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        onClearRecentSearches?.();
                        setActiveSuggestionIndex(-1);
                      }}
                      className="rounded px-2 py-1 text-[11px] text-neutral-400 hover:text-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                    >
                      Clear recent searches
                    </button>
                  </div>
                )}
                <div id={suggestionListId} role="listbox" aria-label="Search suggestions">
                  {isEmptyQuery ? (
                    <>
                      {emptySuggestionGroups.recent.length > 0 && (
                        <div role="group" aria-label="Recent">
                          <h3 className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Recent</h3>
                          {emptySuggestionGroups.recent.map((item, index) => renderSuggestionOption(item, index, false))}
                        </div>
                      )}
                      {emptySuggestionGroups.topics.length > 0 && (
                        <div role="group" aria-label="Topics">
                          <h3 className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Topics</h3>
                          {emptySuggestionGroups.topics.map((item, index) => renderSuggestionOption(item, emptySuggestionGroups.recent.length + index, false))}
                        </div>
                      )}
                    </>
                  ) : typedSuggestions.map((item, index) => renderSuggestionOption(item, index, true))}
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <select
              id="search-network-select"
              value={selectedNetwork}
              onChange={(e) => {
                setSelectedNetwork(e.target.value);
                executeSearch(query, e.target.value, true);
              }}
              className="rounded-xl border border-neutral-700 bg-neutral-950 px-3.5 py-2.5 text-xs font-medium text-neutral-200 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 cursor-pointer"
            >
              {NETWORKS.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>

            <button
              type="submit"
              id="execute-search-btn"
              className="flex items-center gap-2 rounded-xl bg-purple-600 px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-purple-600/20 transition hover:bg-purple-500 active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              <span>Search</span>
            </button>
          </div>
        </form>

        {/* Suggestion Chips */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-[11px] text-neutral-500 mr-1 flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-purple-400" /> Topics:
          </span>
          {SUGGESTIONS.map((s, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                setQuery(s);
                onRecordSearch?.(s);
                executeSearch(s, selectedNetwork, true);
              }}
              className="rounded-md border border-neutral-800 bg-neutral-950/80 px-2.5 py-1 text-[11px] text-neutral-400 transition hover:border-purple-500/50 hover:text-purple-300 cursor-pointer"
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <section ref={searchRegionRef} data-testid="search-results-region" className="space-y-4">
      {/* ── Search Status & Results Count ─────────────────────────────────── */}
      {hasSearched && !loading && (
        <div className="flex items-center justify-between text-xs text-neutral-400 px-1">
          <h2 ref={searchHeadingRef} tabIndex={-1} data-testid="search-results-heading" className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400">
            {error ? 'Search results unavailable.' : <>Found <strong className="text-neutral-200">{total}</strong> broadcast results in{' '}
              <strong className="text-purple-300">{NETWORKS.find((n) => n.id === selectedNetwork)?.name}</strong></>}
          </h2>
          {!error && lastQuery && <span>Query: &ldquo;{lastQuery}&rdquo;</span>}
        </div>
      )}

      {/* ── Error Banner ─────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center justify-between rounded-xl border border-rose-900/50 bg-rose-950/20 p-4 text-xs text-rose-300">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => executeSearch(query, selectedNetwork, true)}
            className="rounded bg-rose-900/40 px-2.5 py-1 text-xs text-rose-200 hover:bg-rose-900/60"
          >
            Retry
          </button>
        </div>
      )}

      
      {/* ── Channel Builder Panel ────────────────────────────────────────── */}
      {hasSearched && !loading && (
        <div className="rounded-xl border border-purple-800/50 bg-purple-900/10 p-5 mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-purple-200">Archive Discovery</h3>
              <p className="text-xs text-purple-400/80 mt-1">Convert these search results into a curated 24/7 channel.</p>
            </div>
            <button
              type="button"
              onClick={handleBuildChannel}
              disabled={buildStatus === 'building' || items.length === 0}
              className="flex items-center gap-2 rounded-xl bg-purple-600 px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-purple-600/20 transition hover:bg-purple-500 active:scale-95 disabled:opacity-50"
            >
              {buildStatus === 'building' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {buildStatus === 'building' ? 'Building...' : 'Create 24/7 Channel'}
            </button>
          </div>
          
          {buildStatus === 'error' && buildError && <p role="alert" className="text-[11px] text-red-400">Channel not built: {buildError}</p>}
          {buildStatus === 'done' && (
            <div className="rounded border border-neutral-800 bg-neutral-900/50 p-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-medium text-neutral-300">Channel Built Successfully</h4>
                <button
                  onClick={() => built && builtAssets[0] && onPlayProgram(builtAssets[0].archivePath || builtAssets[0].mediaUrl, builtAssets[0].title, built.name, "video", built.channelId, built.guideId, builtAssets[0].id, undefined, undefined, undefined, bufferGaugeMetadata(builtAssets[0].metadata))}
                  className="rounded bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-500 transition"
                >
                  Tune In Now
                </button>
              </div>
              <p className="text-[11px] text-neutral-500 mb-3">{built?.name}: {built?.items} recordings → {built?.clips} clips, played in order and looped.{built && built.skipped.length ? ` ${built.skipped.length} skipped (${built.skipped[0].reason}).` : ''}</p>
              <div className="flex flex-col gap-2 max-h-40 overflow-y-auto pr-2">
                {builtAssets.map((asset, i) => (
                  <div key={i} className="flex items-center justify-between text-[11px] border-b border-neutral-800/50 pb-1">
                    <span className="text-neutral-300 truncate pr-2">{asset.title}</span>
                    <span className="shrink-0 text-neutral-500 font-mono">{Math.round((Number(asset.metadata?.durationSeconds) || 0) / 60)} min</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
{/* ── Results Grid ─────────────────────────────────────────────────── */}
      {loading ? (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-16 text-center space-y-3">
          <RefreshCw className="mx-auto h-8 w-8 text-purple-400 animate-spin" />
          <p className="text-xs text-neutral-400 font-medium">Searching Library TV News collections...</p>
        </div>
      ) : items.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {items.map((item) => {
            const safePath = `/download/${item.identifier}/${item.identifier}.mp4?start=0&end=300`;

            return (
              <div
                key={item.identifier}
                className="group flex flex-col justify-between rounded-xl border border-neutral-800 bg-neutral-900/50 p-5 transition hover:border-purple-500/40 hover:bg-neutral-900"
              >
                <div className="space-y-3">
                  {/* Top metadata tags */}
                  <div className="flex items-center justify-between">
                    <span className="rounded bg-neutral-800 px-2 py-0.5 font-mono text-[10px] font-semibold text-neutral-300">
                      {item.network || selectedNetwork}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] text-neutral-400">
                      <Calendar className="h-3 w-3" />
                      {item.date}
                    </span>
                  </div>

                  {/* Title & Description */}
                  <div>
                    <h3 className="text-sm font-semibold text-neutral-100 group-hover:text-purple-300 transition line-clamp-2">
                      {item.title || item.program}
                    </h3>
                    <p className="mt-1.5 text-xs text-neutral-400 line-clamp-3 leading-relaxed">
                      {item.description || `Internet Archive TV News broadcast record (${item.identifier}).`}
                    </p>
                  </div>
                </div>

                {/* Footer action */}
                <div className="mt-5 pt-3.5 border-t border-neutral-800 flex items-center justify-between">
                  <span className="text-[11px] font-mono text-neutral-500">
                    {item.time !== 'Unknown' ? `${item.time} UTC` : 'Broadcast Reel'}
                  </span>

                  <button
                    type="button"
                    onClick={() =>
                      onPlayProgram(
                        safePath,
                        item.title || item.program,
                        `${item.network} • ${item.date}`
                      )
                    }
                    className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-purple-500 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 cursor-pointer"
                  >
                    <Play className="h-3 w-3 fill-current" />
                    Watch Broadcast
                  </button>
                </div>
              </div>
            );
          })}
        </div>
) : (
        hasSearched && !error && (
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-12 text-center space-y-2">
            <Search className="mx-auto h-8 w-8 text-neutral-600" />
            <h3 className="text-sm font-medium text-neutral-300">No broadcasts found</h3>
            <p className="text-xs text-neutral-500">
              Try searching with broader keywords or select another network from the dropdown.
            </p>
          </div>
        )
      )}
      </section>
    </div>
  );
}
