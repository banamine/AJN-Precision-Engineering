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
  Bookmark,
  ChevronDown,
  X,
  Box,
  Settings2,
} from 'lucide-react';
import { Destination, NowPlayingMedia, PlayProgramCallback } from '../types';
import { SuggestInput } from './SuggestInput';
import type { SuggestCandidate } from '../utils/suggest';
import { StatusIndicators } from './StatusIndicators';
import { useAjnAppearance } from './ajn-platform-redesign/AppearanceProvider';

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
  { id: 'home', label: 'Discover', icon: Home, description: 'Live broadcast & featured feeds' },
  { id: 'tv-guide', label: 'Live TV Guide', icon: Tv, description: '24-hour program schedule grid' },
  { id: 'player', label: 'Player', icon: PlayCircle, description: 'Active broadcast monitor' },
  { id: 'news', label: 'News', icon: Newspaper, description: 'Rumble, YouTube & Banned Video walls' },
  { id: 'radio', label: 'AJN Radio', icon: Radio, description: 'AJN Radio & Exclusive episodes' },
  { id: 'history', label: 'History', icon: HistoryIcon, description: 'Everything you have played' },
  { id: 'library', label: 'Archive Vault', icon: FolderArchive, description: 'Curated archives & vaults' },
  { id: 'search', label: 'Search', icon: Search, description: 'TV News search' },
  { id: 'watch-later', label: 'Watch Later', icon: Bookmark, description: 'Saved, and half-played, to finish later' },
];

const DESKTOP_PRIMARY: NavItemConfig[] = [
  PRIMARY_DESTINATIONS[0],
  PRIMARY_DESTINATIONS[1],
  PRIMARY_DESTINATIONS[2],
  PRIMARY_DESTINATIONS[3],
];
const MY_LIBRARY_ITEMS: NavItemConfig[] = [PRIMARY_DESTINATIONS[5], PRIMARY_DESTINATIONS[8]];
// Keep all existing destinations directly reachable on mobile.
const MOBILE_DESTINATIONS: NavItemConfig[] = [0, 1, 2, 3, 4, 5, 8, 6, 7].map((i) => PRIMARY_DESTINATIONS[i]);
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
  const { openAppearance } = useAjnAppearance();
  const [vaultOpen, setVaultOpen] = useState(false);
  const vaultRef = useRef<HTMLDivElement>(null);
  const closeVault = React.useCallback(() => setVaultOpen(false), []);
  useDismiss(vaultOpen, closeVault, vaultRef);
  const [myLibraryOpen, setMyLibraryOpen] = useState(false);
  const myLibraryRef = useRef<HTMLDivElement>(null);
  const closeMyLibrary = React.useCallback(() => setMyLibraryOpen(false), []);
  useDismiss(myLibraryOpen, closeMyLibrary, myLibraryRef);

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
  const activeDestination = currentDestination === 'today' ? 'tv-guide' : currentDestination === 'player' ? null : currentDestination;
  const vaultActive = VAULT_ITEMS.some((v) => v.id === activeDestination);
  const myLibraryActive = MY_LIBRARY_ITEMS.some((item) => item.id === activeDestination);

  return (
    <>
      {/* ── Desktop / Tablet Header Navigation Bar ──────────────────────────────── */}
      <header
        id="canonical-app-header"
        className="ajn-redesign-surface ajn-redesign-nav sticky top-0 z-40 w-full border-b border-neutral-800/80 bg-neutral-950/90 backdrop-blur-md"
      >
        <div className="mx-auto flex h-14 lg:h-[52px] w-full max-w-7xl 2xl:max-w-[1600px] items-center justify-between px-3 sm:px-6 lg:px-8">
          {/* Brand & Badge */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              type="button"
              id="brand-logo-btn"
              onClick={() => onNavigate('home')}
              title="AJN Precision Broadcast Engine - Return to Home"
              className="flex min-h-[44px] min-w-[44px] items-center gap-2 sm:gap-2.5 rounded-lg px-1 py-1 text-left transition hover:opacity-90 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ajn-accent)] -ml-1 cursor-pointer touch-manipulation"
            >
              <div className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--ajn-line)] bg-[var(--ajn-card-2)] text-[var(--ajn-accent)]">
                <Radio className="h-4 w-4 sm:h-5 sm:w-5 motion-safe:animate-pulse" />
              </div>
              <div className="hidden 2xl:flex flex-col min-w-0">
                <span className="text-xs sm:text-sm font-semibold tracking-tight text-neutral-100 truncate">AJN Precision</span>
                <span className="text-[9px] sm:text-[10px] font-mono uppercase tracking-wider sm:tracking-widest text-neutral-400 truncate">Broadcast Engine</span>
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
              const isActive = activeDestination === item.id;
              const hasBadge = item.id === 'player' && nowPlaying;

              return (
                <button
                  key={item.id}
                  id={`nav-link-${item.id}`}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  aria-label={item.label}
                  title={item.label}
                  className={`group relative flex min-h-[44px] shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-transparent px-3 xl:px-3.5 py-2 text-xs font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ajn-accent)] cursor-pointer ${
                    isActive
                      ? 'ajn-nav-item-active'
                      : 'text-neutral-300 hover:bg-neutral-900 hover:text-neutral-100 border border-transparent'
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 transition-transform group-hover:scale-105 ${
                      isActive ? 'text-[var(--ajn-accent)]' : 'text-neutral-400'
                    }`}
                  />
                  <span className="hidden xl:inline">{item.label}</span>

                  {/* Active playing indicator badge on Player tab */}
                  {hasBadge && (
                    <span className="relative flex h-2 w-2 ml-0.5">
                      <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                  )}

                  {isActive && (
                    <span className="ajn-nav-underline absolute -bottom-[9px] left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-full" />
                  )}
                </button>
              );
            })}
            <div ref={myLibraryRef} className="relative">
              <button
                type="button"
                id="nav-link-my-library"
                aria-haspopup="menu"
                aria-expanded={myLibraryOpen}
                aria-current={myLibraryActive ? 'page' : undefined}
                onClick={() => setMyLibraryOpen((open) => !open)}
                className={`group relative flex min-h-[44px] shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-transparent px-3 xl:px-3.5 py-2 text-xs font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ajn-accent)] cursor-pointer ${myLibraryActive ? 'ajn-nav-item-active' : 'text-neutral-300 hover:bg-neutral-900 hover:text-neutral-100'}`}
              >
                <Bookmark className={`h-4 w-4 ${myLibraryActive ? 'text-[var(--ajn-accent)]' : 'text-neutral-400'}`} />
                <span className="hidden xl:inline">My Library</span>
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${myLibraryOpen ? 'rotate-180' : ''}`} />
                {myLibraryActive && <span className="ajn-nav-underline absolute -bottom-[9px] left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-full" />}
              </button>
              {myLibraryOpen && (
                <div role="menu" aria-label="My Library" className="absolute left-0 top-full z-50 mt-2 w-56 rounded-xl border border-neutral-800 bg-neutral-950/95 p-1.5 shadow-xl backdrop-blur-md">
                  {MY_LIBRARY_ITEMS.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeDestination === item.id;
                    return (
                      <button
                        key={item.id}
                        id={`nav-link-${item.id}`}
                        role="menuitem"
                        type="button"
                        onClick={() => { setMyLibraryOpen(false); onNavigate(item.id); }}
                        aria-current={isActive ? 'page' : undefined}
                        className={`flex min-h-[44px] w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition hover:bg-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ajn-accent)] ${isActive ? 'text-[var(--ajn-accent)]' : 'text-neutral-200'}`}
                      >
                        <Icon className={`h-4 w-4 ${isActive ? 'text-[var(--ajn-accent)]' : 'text-neutral-400'}`} />
                        <span className="flex flex-col"><span className="font-medium">{item.label}</span><span className="text-[10px] text-neutral-500">{item.description}</span></span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div ref={vaultRef} className="relative">
              <button
                type="button"
                id="nav-link-vault"
                aria-haspopup="menu"
                aria-expanded={vaultOpen}
                aria-current={vaultActive ? 'page' : undefined}
                onClick={() => setVaultOpen((o) => !o)}
                className={`group relative flex min-h-[44px] shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-transparent px-3 xl:px-3.5 py-2 text-xs font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ajn-accent)] cursor-pointer ${
                  vaultActive
                    ? 'ajn-nav-item-active'
                    : 'text-neutral-300 hover:bg-neutral-900 hover:text-neutral-100 border border-transparent'
                }`}
              >
                <FolderArchive className={`h-4 w-4 ${vaultActive ? 'text-[var(--ajn-accent)]' : 'text-neutral-400'}`} />
                <span className="hidden xl:inline">Vault</span>
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
                        aria-current={activeDestination === item.id ? 'page' : undefined}
                        className={`flex min-h-[44px] w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition hover:bg-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ajn-accent)] ${
                          activeDestination === item.id ? 'text-[var(--ajn-accent)]' : 'text-neutral-200'
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
            <button
              type="button"
              id="ajn-appearance-open"
              onClick={openAppearance}
              aria-label="Open appearance settings"
              title="Appearance settings"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-900 text-neutral-200 transition hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ajn-accent)]"
            >
              <Settings2 className="h-5 w-5" aria-hidden="true" />
            </button>
            <form
              ref={searchRef}
              role="search"
              id="header-search"
              onSubmit={submitSearch}
              className={`relative hidden md:flex items-center rounded-lg border bg-neutral-900/80 backdrop-blur-md transition-all duration-200 ${
                searchOpen ? 'w-64 border-[var(--ajn-accent)]' : `w-10 border-neutral-800 ${activeDestination === 'search' ? 'text-[var(--ajn-accent)]' : ''}`
              }`}
            >
              <button
                type="button"
                id="nav-link-search"
                aria-label="Search (/ or Ctrl+K)"
                title="Search ( / or Ctrl+K )"
                aria-current={activeDestination === 'search' ? 'page' : undefined}
                onClick={() => { setSearchOpen(true); window.setTimeout(() => searchInputRef.current?.focus(), 0); }}
                className="flex h-11 w-11 shrink-0 items-center justify-center text-neutral-300 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ajn-accent)]"
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
                <button type="button" aria-label="Clear search" onClick={() => { setSearchText(''); searchInputRef.current?.focus(); }} className="mr-1 flex h-11 w-11 items-center justify-center text-neutral-400 hover:text-white">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </form>
            {nowPlaying && (
              <button
                type="button"
                id="header-now-playing-pill"
                onClick={() => onNavigate('player')}
                className="hidden xl:flex min-h-[44px] items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900/90 py-1 pl-2.5 pr-3 text-xs text-neutral-300 transition hover:border-neutral-700 hover:text-white"
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
        className="ajn-redesign-surface ajn-redesign-nav fixed bottom-0 inset-x-0 z-40 flex h-14 sm:h-16 w-full items-stretch justify-around border-t border-neutral-800/90 bg-neutral-950/95 backdrop-blur-lg md:hidden px-1 sm:px-2 pb-safe select-none"
      >
        {MOBILE_DESTINATIONS.map((item) => {
          const Icon = item.icon;
          const isActive = activeDestination === item.id;
          const hasBadge = item.id === 'player' && nowPlaying;

          return (
            <button
              key={item.id}
              id={`mobile-nav-${item.id}`}
              type="button"
              onClick={() => onNavigate(item.id)}
              aria-current={isActive ? 'page' : undefined}
              aria-label={`${item.label} (${item.description})`}
              className={`relative min-w-[44px] min-h-[48px] h-full flex flex-col items-center justify-center gap-0.5 sm:gap-1 py-1 px-2 text-center transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ajn-accent)] cursor-pointer touch-manipulation ${
                isActive ? 'ajn-nav-item-active font-semibold' : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <div className="relative flex items-center justify-center">
                <Icon className={`h-[18px] w-[18px] sm:h-5 sm:w-5 transition-transform ${isActive ? 'text-[var(--ajn-accent)] scale-105' : 'text-neutral-400'}`} />
                {hasBadge && (
                  <span className="absolute -top-1 -right-1 flex h-2 w-2">
                    <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                )}
              </div>
              <span className="whitespace-nowrap text-[10px] sm:text-[11px] leading-tight tracking-tight px-0.5 font-medium">
                {item.id === 'tv-guide' ? 'Guide' : item.id === 'radio' ? 'Radio' : item.id === 'watch-later' ? 'Later' : item.id === 'library' ? 'Vault' : item.label}
              </span>
              {isActive && (
                <span className="ajn-nav-underline absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-6 sm:w-8 rounded-full" />
              )}
            </button>
          );
        })}
      </nav>
    </>
  );
}
