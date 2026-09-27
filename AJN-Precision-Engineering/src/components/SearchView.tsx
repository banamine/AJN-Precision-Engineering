import React, { useState, useEffect, useCallback, FormEvent } from 'react';
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
import { TVNewsItem } from '../../channels';
import { PlayProgramCallback } from '../types';

interface SearchViewProps {
  onPlayProgram: PlayProgramCallback;
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

export function SearchView({ onPlayProgram }: SearchViewProps) {
    const [buildStatus, setBuildStatus] = useState<string>('');
  const [builtAssets, setBuiltAssets] = useState<any[]>([]);

  const handleBuildChannel = async () => {
    setBuildStatus('building');
    try {
      const res = await fetch('/api/channels/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query || selectedNetwork, channelId: 'cinema-vault', channelName: query || 'Archive Discovery' })
      });
      const data = await res.json();
      setBuiltAssets(data.playlist || []);
      setBuildStatus('done');
    } catch (e) {
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

  const executeSearch = useCallback(
    async (searchTerm: string, network: string) => {
      setLoading(true);
      setError(null);
      setHasSearched(true);
      try {
        const url = `/api/search?network=${encodeURIComponent(network)}&q=${encodeURIComponent(searchTerm)}&rows=24`;
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`Search failed: HTTP ${res.status}`);
        }
        const data = await res.json();
        setItems(Array.isArray(data.items) ? data.items : []);
        setTotal(data.total || 0);
      } catch (err: any) {
        setError(err.message || 'An error occurred while querying the archive');
        setItems([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Initial search on mount
  useEffect(() => {
    executeSearch('', selectedNetwork);
  }, [executeSearch, selectedNetwork]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    executeSearch(query, selectedNetwork);
  };

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
              type="text"
              id="tvnews-search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search broadcast topics, speakers, or events..."
              className="w-full rounded-xl border border-neutral-700 bg-neutral-950 pl-10 pr-4 py-2.5 text-sm text-neutral-100 placeholder-neutral-500 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
          </div>

          <div className="flex gap-2">
            <select
              id="search-network-select"
              value={selectedNetwork}
              onChange={(e) => {
                setSelectedNetwork(e.target.value);
                executeSearch(query, e.target.value);
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
              disabled={loading}
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
                executeSearch(s, selectedNetwork);
              }}
              className="rounded-md border border-neutral-800 bg-neutral-950/80 px-2.5 py-1 text-[11px] text-neutral-400 transition hover:border-purple-500/50 hover:text-purple-300 cursor-pointer"
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* ── Search Status & Results Count ─────────────────────────────────── */}
      {hasSearched && !loading && (
        <div className="flex items-center justify-between text-xs text-neutral-400 px-1">
          <span>
            Found <strong className="text-neutral-200">{total}</strong> broadcast results in{' '}
            <strong className="text-purple-300">
              {NETWORKS.find((n) => n.id === selectedNetwork)?.name}
            </strong>
          </span>
          {query && <span>Query: &ldquo;{query}&rdquo;</span>}
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
            onClick={() => executeSearch(query, selectedNetwork)}
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
              disabled={buildStatus === 'building'}
              className="flex items-center gap-2 rounded-xl bg-purple-600 px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-purple-600/20 transition hover:bg-purple-500 active:scale-95 disabled:opacity-50"
            >
              {buildStatus === 'building' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {buildStatus === 'building' ? 'Building...' : 'Create 24/7 Channel'}
            </button>
          </div>
          
          {buildStatus === 'done' && (
            <div className="rounded border border-neutral-800 bg-neutral-900/50 p-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-medium text-neutral-300">Channel Built Successfully</h4>
                <button
                  onClick={() => onPlayProgram(builtAssets[0]?.mediaUrl, builtAssets[0]?.title, "Cinema Vault", "video", "cinema-vault", "cable-tv")}
                  className="rounded bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-500 transition"
                >
                  Tune In Now
                </button>
              </div>
              <p className="text-[11px] text-neutral-500 mb-3">Extracted {builtAssets.length} playable media assets.</p>
              <div className="flex flex-col gap-2 max-h-40 overflow-y-auto pr-2">
                {builtAssets.map((asset, i) => (
                  <div key={i} className="flex items-center justify-between text-[11px] border-b border-neutral-800/50 pb-1">
                    <span className="text-neutral-300 truncate pr-2">{asset.title}</span>
                    <div className="flex gap-2 shrink-0">
                      <span className="text-purple-400 font-mono">[{asset.quality?.label}]</span>
                      <span className="text-neutral-500">{asset.category}</span>
                    </div>
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
          <p className="text-xs text-neutral-400 font-medium">Searching Archive.org TV News collections...</p>
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
        hasSearched && (
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-12 text-center space-y-2">
            <Search className="mx-auto h-8 w-8 text-neutral-600" />
            <h3 className="text-sm font-medium text-neutral-300">No broadcasts found</h3>
            <p className="text-xs text-neutral-500">
              Try searching with broader keywords or select another network from the dropdown.
            </p>
          </div>
        )
      )}
    </div>
  );
}
