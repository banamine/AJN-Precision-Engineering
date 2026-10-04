import React from 'react';
import {
  Home,
  Tv,
  PlayCircle,
  FolderArchive,
  Search,
  Radio,
  Newspaper,
} from 'lucide-react';
import { Destination, NowPlayingMedia } from '../types';

interface NavigationProps {
  currentDestination: Destination;
  onNavigate: (dest: Destination) => void;
  nowPlaying: NowPlayingMedia | null;
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
  { id: 'library', label: 'Library', icon: FolderArchive, description: 'Curated archives & vaults' },
  { id: 'search', label: 'Search', icon: Search, description: 'Archive.org TV News search' },
];

export function Navigation({
  currentDestination,
  onNavigate,
  nowPlaying,
}: NavigationProps) {
  return (
    <>
      {/* ── Desktop / Tablet Header Navigation Bar ──────────────────────────────── */}
      <header
        id="canonical-app-header"
        className="sticky top-0 z-40 w-full border-b border-neutral-800/80 bg-neutral-950/90 backdrop-blur-md"
      >
        <div className="mx-auto flex h-14 sm:h-16 w-full max-w-7xl items-center justify-between px-3 sm:px-6 lg:px-8">
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
                <Radio className="h-4 w-4 sm:h-5 sm:w-5 animate-pulse" />
              </div>
              <div className="flex flex-col min-w-0">
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
            {PRIMARY_DESTINATIONS.map((item) => {
              const Icon = item.icon;
              const isActive = currentDestination === item.id;
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
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                  )}

                  {isActive && (
                    <span className="absolute -bottom-[9px] left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-full bg-sky-400" />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Right Header Utility: Dev Mode Access & Stream Status */}
          <div className="flex items-center gap-2.5">
            {nowPlaying && (
              <button
                type="button"
                id="header-now-playing-pill"
                onClick={() => onNavigate('player')}
                className="hidden lg:flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900/90 py-1 pl-2.5 pr-3 text-xs text-neutral-300 transition hover:border-neutral-700 hover:text-white"
                title={`Now Playing: ${nowPlaying.title}`}
              >
                <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
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
          const isActive = currentDestination === item.id;
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
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                )}
              </div>
              <span className="text-[10px] sm:text-[11px] leading-tight tracking-tight truncate max-w-full px-0.5 font-medium">
                {item.label}
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
