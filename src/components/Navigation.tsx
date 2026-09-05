import React from 'react';
import {
  Home,
  Tv,
  PlayCircle,
  FolderArchive,
  Search,
  Radio,
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
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          {/* Brand & Badge */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              id="brand-logo-btn"
              onClick={() => onNavigate('home')}
              className="flex items-center gap-2.5 rounded-lg text-left transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/25">
                <Radio className="h-5 w-5 animate-pulse" />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-semibold tracking-tight text-neutral-100">
                  AJN Precision
                </span>
                <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-400">
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

          {/* Right Header Utility: Stream Status */}
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
        className="fixed bottom-0 inset-x-0 z-40 flex h-16 w-full items-center justify-around border-t border-neutral-800/90 bg-neutral-950/95 backdrop-blur-lg md:hidden px-2 pb-safe"
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
              className={`relative flex min-h-[44px] min-w-[56px] flex-col items-center justify-center gap-1 py-1 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                isActive ? 'text-sky-400 font-semibold' : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <div className="relative">
                <Icon className={`h-5 w-5 ${isActive ? 'text-sky-400' : 'text-neutral-400'}`} />
                {hasBadge && (
                  <span className="absolute -top-1 -right-1 flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                )}
              </div>
              <span className="leading-none">{item.label}</span>
              {isActive && (
                <span className="absolute top-0 h-0.5 w-8 rounded-full bg-sky-400" />
              )}
            </button>
          );
        })}
      </nav>
    </>
  );
}
