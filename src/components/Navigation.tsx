import React, { useEffect, useRef, useState } from 'react';
import {
  Home,
  Tv,
  PlayCircle,
  FolderArchive,
  Search,
  Radio,
  Newspaper,
  History as HistoryIcon,
  ChevronDown,
  X,
  Box,
} from 'lucide-react';
import { Destination, NowPlayingMedia, PlayProgramCallback } from '../types';
import { SuggestInput } from './SuggestInput';
import type { SuggestCandidate } from '../utils/suggest';
import { StatusIndicators } from './StatusIndicators';

interface NavigationProps {
  currentDestination: Destination;
  onNavigate: (dest: Destination) => void;
  nowPlaying: NowPlayingMedia | null;
  /** Header search submit. Omitted → the search icon just opens the Search view. */
  onSearch?: (query: string) => void;
  /** Candidates for the auto-fill dropdown (recent searches, favorites, history, seed topics). */
  suggestions?: SuggestCandidate[];
  /** Used by the News status report's "Play" buttons (opened only on click). */
  onPlayProgram?: PlayProgramCallback;
}

interface NavItemConfig {
  id: Destination;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}

const PRIMARY_DESTINATIONS: NavItemConfig[] = [
  { id: 'home', label: 'Home', icon: Home, description: 'Live broadcast & featured feeds' },
  { id: 'tv-guide', label: 'TV Guide', icon: Tv, description: '24-hour program schedule grid' },
  { id: 'player', label: 'Player', icon: PlayCircle, description: 'Active broadcast monitor' },
  { id: 'news', label: 'News', icon: Newspaper, description: 'Live Rumble news wall' },
  { id: 'radio', label: 'AJN Radio', icon: Radio, description: 'AJN Radio & Exclusive episodes' },
  { id: 'history', label: 'History', icon: HistoryIcon, description: 'Everything you have played' },
  { id: 'library', label: 'Library', icon: FolderArchive, description: 'Curated archives & vaults' },
  { id: 'search', label: 'Search', icon: Search, description: 'Archive.org TV News search' },
];

const DESKTOP_PRIMARY: NavItemConfig[] = [
  { ...PRIMARY_DESTINATIONS[0], label: 'Live' },
  { ...PRIMARY_DESTINATIONS[1], label: 'Guide' },
  PRIMARY_DESTINATIONS[2],
  PRIMARY_DESTINATIONS[3],
  PRIMARY_DESTINATIONS[5],
];
const VAULT_ITEMS: NavItemConfig[] = [
  PRIMARY_DESTINATIONS[4],
  PRIMARY_DESTINATIONS[6],
  { id: 'news-cube', label: 'NEWS CUBE', icon: Box, description: 'Daily News Digest headlines in a six-face cube' },
];

function useDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, close, ref]);
}

export function Navigation({
  currentDestination,
  onNavigate,
  nowPlaying,
  onSearch,
  suggestions = [],
  onPlayProgram,
}: NavigationProps) {
  const [vaultOpen, setVaultOpen] = useState(false);
  const vaultRef = useRef<HTMLDivElement>(null);
  const closeVault = React.useCallback(() => setVaultOpen(false), []);
  useDismiss(vaultOpen, closeVault, vaultRef);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const searchRef = useRef<HTMLFormElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const closeSearch = React.useCallback(() => setSearchOpen(false), []);
  useDismiss(searchOpen, closeSearch, searchRef);

  // "/" or Ctrl/Cmd+K focuses search (ignored while typing in another field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      const combo = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k';
      const slash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !typing;
      if (!combo && !slash) return;
      e.preventDefault();
      setSearchOpen(true);
      window.setTimeout(() => searchInputRef.current?.focus(), 0);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchText.trim();
    if (onSearch) onSearch(q);
    else onNavigate('search');
    if (!q) setSearchOpen(false);
  };
  const pickSuggestion = (text: string) => { setSearchText(text); if (onSearch) onSearch(text); else onNavigate('search'); };
  const vaultActive = VAULT_ITEMS.some((v) => v.id === currentDestination);

  return (
    <>
      {/* ── Desktop / Tablet Header Navigation Bar ──────────────────────────────── */}
      <header
        id="canonical-app-header"
        className="sticky top-0 z-40 w-full border-b border-neutral-800/80 bg-neutral-950/90 backdrop-blur-md"
      >
        <div className="mx-auto flex h-14 lg:h-[52px] w-full max-w-7xl items-center justify-between px-3 sm:px-6 lg:px-8">
          {/* Brand & Badge */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              type="button"
              id="brand-logo-btn"
              onClick={() => onNavigate('home')}
              title="AJN Precision Broadcast Engine - Return to Home"
              className="flex items-center gap-2 sm:gap-2.5 rounded-lg text-left transition hover:opacity-90 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 min-h-[44px] min-w-[44px] py-1 px-1 -ml-1 cursor-pointer touch-manipulation"
            >
              <div className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/25">
                <Radio className="h-4 w-4 sm:h-5 sm:w-5 motion-safe:animate-pulse" />
              </div>
              <div className="hidden lg:flex flex-col min-w-0">
                <span className="text-xs sm:text-sm font-semibold tracking-tight text-neutral-100 truncate">
                  AJN Precision
                </span>
                <span className="text-[9px] sm:text-[10px] font-mono uppercase tracking-wider sm:tracking-widest text-neutral-400 truncate">
                  Broadcast Engine
                </span>
              </div>
            </button>
          </div>

          {/* Desktop 5-Destination Nav Menu */}
          <nav
            role="navigation"
            aria-label="Primary Destinations"
            className="hidden md:flex items-center gap-1.5"
          >
            {DESKTOP_PRIMARY.map((item) => {
              const Icon = item.icon;
              const isActive = (currentDestination === 'today' ? 'tv-guide' : currentDestination) === item.id;
              const hasBadge = item.id === 'player' && nowPlaying;

              return (
                <button
                  key={item.id}
                  id={`nav-link-${item.id}`}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`group relative flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 cursor-pointer ${
                    isActive
                      ? 'bg-neutral-800/90 text-sky-400 shadow-inner border border-neutral-700/80'
                      : 'text-neutral-300 hover:bg-neutral-900 hover:text-neutral-100 border border-transparent'
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 transition-transform group-hover:scale-105 ${
                      isActive ? 'text-sky-400' : 'text-neutral-400'
                    }`}
                  />
                  <span>{item.label}</span>

                  {/* Active playing indicator badge on Player tab */}
                  {hasBadge && (
                    <span className="relative flex h-2 w-2 ml-0.5">
                      <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                  )}

                  {isActive && (
                    <span className="absolute -bottom-[9px] left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-full bg-sky-400" />
                  )}
                </button>
              );
            })}
            <div ref={vaultRef} className="relative">
              <button
                type="button"
                id="nav-link-vault"
                aria-haspopup="menu"
                aria-expanded={vaultOpen}
                onClick={() => setVaultOpen((o) => !o)}
                className={`group relative flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 cursor-pointer ${
                  vaultActive
                    ? 'bg-neutral-800/90 text-sky-400 shadow-inner border border-neutral-700/80'
                    : 'text-neutral-300 hover:bg-neutral-900 hover:text-neutral-100 border border-transparent'
                }`}
              >
                <FolderArchive className={`h-4 w-4 ${vaultActive ? 'text-sky-400' : 'text-neutral-400'}`} />
                <span>Vault</span>
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${vaultOpen ? 'rotate-180' : ''}`} />
              </button>
              {vaultOpen && (
                <div role="menu" aria-label="Vault" className="absolute left-0 top-full z-50 mt-2 w-56 rounded-xl border border-neutral-800 bg-neutral-950/95 p-1.5 shadow-xl backdrop-blur-md">
                  {VAULT_ITEMS.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        id={`nav-link-${item.id}`}
                        role="menuitem"
                        type="button"
                        onClick={() => { setVaultOpen(false); onNavigate(item.id); }}
                        aria-current={currentDestination === item.id ? 'page' : undefined}
                        className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition hover:bg-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                          currentDestination === item.id ? 'text-sky-400' : 'text-neutral-200'
                        }`}
                      >
                        <Icon className="h-4 w-4 text-neutral-400" />
                        <span className="flex flex-col"><span className="font-medium">{item.label}</span><span className="text-[10px] text-neutral-500">{item.description}</span></span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </nav>

          {/* Right Header Utility: Dev Mode Access & Stream Status */}
          <div className="flex min-w-0 items-center gap-2">
            <StatusIndicators onPlayProgram={onPlayProgram} />
            <form
              ref={searchRef}
              role="search"
              id="header-search"
              onSubmit={submitSearch}
              className={`relative hidden md:flex items-center rounded-lg border bg-neutral-900/80 backdrop-blur-md transition-all duration-200 ${
                searchOpen ? 'w-64 border-sky-500/50' : `w-10 border-neutral-800 ${currentDestination === 'search' ? 'text-sky-400' : ''}`
              }`}
            >
              <button
                type="button"
                id="nav-link-search"
                aria-label="Search (/ or Ctrl+K)"
                title="Search ( / or Ctrl+K )"
                aria-current={currentDestination === 'search' ? 'page' : undefined}
                onClick={() => { setSearchOpen(true); window.setTimeout(() => searchInputRef.current?.focus(), 0); }}
                className="flex h-9 w-10 shrink-0 items-center justify-center text-neutral-300 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
              >
                <Search className="h-4 w-4" />
              </button>
              <SuggestInput
                inputRef={searchInputRef}
                value={searchText}
                onChange={setSearchText}
                onPick={pickSuggestion}
                candidates={suggestions}
                onFocus={() => setSearchOpen(true)}
                onKeyDown={(e) => { if (e.key === 'Escape') { setSearchOpen(false); (e.target as HTMLInputElement).blur(); } }}
                placeholder="Search…"
                ariaLabel="Search archive"
                tabIndex={searchOpen ? 0 : -1}
                className="min-w-0 flex-1 bg-transparent pr-1 text-xs text-neutral-100 placeholder:text-neutral-500 focus:outline-none"
              />
              {searchOpen && searchText && (
                <button type="button" aria-label="Clear search" onClick={() => { setSearchText(''); searchInputRef.current?.focus(); }} className="mr-1 flex h-6 w-6 items-center justify-center text-neutral-400 hover:text-white">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </form>
            {nowPlaying && (
              <button
                type="button"
                id="header-now-playing-pill"
                onClick={() => onNavigate('player')}
                className="hidden xl:flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900/90 py-1 pl-2.5 pr-3 text-xs text-neutral-300 transition hover:border-neutral-700 hover:text-white"
                title={`Now Playing: ${nowPlaying.title}`}
              >
                <span className="flex h-2 w-2 rounded-full bg-emerald-500 motion-safe:animate-pulse" />
                <span className="max-w-[140px] truncate font-medium text-neutral-200">
                  {nowPlaying.title}
                </span>
              </button>
            )}

          </div>
        </div>
      </header>

      {/* ── Mobile Bottom Fixed Tab Bar ────────────────────────────────────────── */}
      <nav
        role="navigation"
        aria-label="Mobile Navigation"
        id="mobile-bottom-nav"
        className="fixed bottom-0 inset-x-0 z-40 flex h-14 sm:h-16 w-full items-stretch justify-around border-t border-neutral-800/90 bg-neutral-950/95 backdrop-blur-lg md:hidden px-1 sm:px-2 pb-safe select-none"
      >
        {PRIMARY_DESTINATIONS.map((item) => {
          const Icon = item.icon;
          const isActive = (currentDestination === 'today' ? 'tv-guide' : currentDestination) === item.id;
          const hasBadge = item.id === 'player' && nowPlaying;

          return (
            <button
              key={item.id}
              id={`mobile-nav-${item.id}`}
              type="button"
              onClick={() => onNavigate(item.id)}
              aria-current={isActive ? 'page' : undefined}
              aria-label={`${item.label} (${item.description})`}
              className={`relative flex-1 min-w-0 min-h-[48px] h-full flex flex-col items-center justify-center gap-0.5 sm:gap-1 py-1 px-0.5 text-center transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 cursor-pointer touch-manipulation ${
                isActive ? 'text-sky-400 font-semibold' : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <div className="relative flex items-center justify-center">
                <Icon className={`h-[18px] w-[18px] sm:h-5 sm:w-5 transition-transform ${isActive ? 'text-sky-400 scale-105' : 'text-neutral-400'}`} />
                {hasBadge && (
                  <span className="absolute -top-1 -right-1 flex h-2 w-2">
                    <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                )}
              </div>
              <span className="text-[10px] sm:text-[11px] leading-tight tracking-tight truncate max-w-full px-0.5 font-medium">
                {item.id === 'tv-guide' ? 'Guide' : item.id === 'radio' ? 'Radio' : item.label}
              </span>
              {isActive && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-6 sm:w-8 rounded-full bg-sky-400" />
              )}
            </button>
          );
        })}
      </nav>
    </>
  );
}
