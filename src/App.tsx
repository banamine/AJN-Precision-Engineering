import { useState, useEffect, useCallback } from 'react';
import { Destination, NowPlayingMedia, RecentlyPlayedItem, PlayProgramCallback } from './types';
import { Navigation } from './components/Navigation';
import { LocalMediaPanel } from './components/LocalMediaPanel';
import { HomeView } from './components/HomeView';
import { AjnResourcePanel } from './components/AjnResourcePanel';
import { TvGuideView } from './components/TvGuideView';
import { PlayerView } from './components/PlayerView';
import { LibraryView } from './components/LibraryView';
import { SearchView } from './components/SearchView';
import { DevModeView } from './components/DevModeView';
import { MiniPlayerDock } from './components/MiniPlayerDock';

const ARCHIVE_PROXY_BASE = '/api/archive/proxy?path=';
const ARCHIVE_DOWNLOAD_PREFIX = '/download/';
const RECENTLY_PLAYED_STORAGE_KEY = 'ajn.recentlyPlayed.v1';
const RECENTLY_PLAYED_LIMIT = 5;

/** Resolve a media reference to exactly one playable transport URL. */
function toPlayableSrc(rawPath: string): string {
  const value = String(rawPath ?? '').trim();
  if (!value) return value;
  if (value.startsWith(ARCHIVE_PROXY_BASE)) return value;

  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.pathname === '/api/archive/proxy' && parsed.searchParams.has('path')) {
      return `${parsed.pathname}${parsed.search}`;
    }
    if (parsed.hostname === 'archive.org' && parsed.pathname.startsWith(ARCHIVE_DOWNLOAD_PREFIX)) {
      const archivePath = `${parsed.pathname}${parsed.search}`;
      return `${ARCHIVE_PROXY_BASE}${encodeURIComponent(archivePath)}`;
    }
  } catch {
    // Preserve non-URL references unchanged below.
  }

  if (value.startsWith(ARCHIVE_DOWNLOAD_PREFIX)) {
    return `${ARCHIVE_PROXY_BASE}${encodeURIComponent(value)}`;
  }
  return value;
}

function getDestinationFromHash(): Destination {
  if (typeof window === 'undefined') return 'home';
  const hash = window.location.hash.replace('#', '').toLowerCase();
  switch (hash) {
    case 'tv-guide':
    case 'guide':
    case 'epg': return 'tv-guide';
    case 'player':
    case 'watch': return 'player';
    case 'library':
    case 'archive': return 'library';
    case 'search': return 'search';
    case 'dev':
    case 'developer':
    case 'diagnostics': return 'dev';
    default: return 'home';
  }
}

function mediaIdentity(media: Pick<NowPlayingMedia, 'src' | 'archivePath' | 'programId' | 'sourceId' | 'assetId'>): string {
  return media.assetId || media.programId || media.sourceId || media.archivePath || media.src;
}

function normalizeRecentlyPlayed(value: unknown): RecentlyPlayedItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is RecentlyPlayedItem => Boolean(item && typeof item === 'object' && 'id' in item && 'title' in item && 'src' in item))
    .map((item) => ({
      ...item,
      progressSeconds: Number.isFinite(item.progressSeconds) && item.progressSeconds >= 0 ? item.progressSeconds : 0,
      updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now(),
    }))
    .filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, RECENTLY_PLAYED_LIMIT);
}

function readRecentlyPlayed(): RecentlyPlayedItem[] {
  if (typeof window === 'undefined') return [];
  try {
    return normalizeRecentlyPlayed(JSON.parse(window.localStorage.getItem(RECENTLY_PLAYED_STORAGE_KEY) || '[]'));
  } catch {
    return [];
  }
}

function writeRecentlyPlayed(items: RecentlyPlayedItem[]): void {
  try {
    window.localStorage.setItem(RECENTLY_PLAYED_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Storage may be unavailable; playback remains unaffected.
  }
}

export default function App() {
  const [destination, setDestination] = useState<Destination>(() => getDestinationFromHash());
  const [nowPlaying, setNowPlaying] = useState<NowPlayingMedia | null>(null);
  const [recentlyPlayed, setRecentlyPlayed] = useState<RecentlyPlayedItem[]>(() => readRecentlyPlayed());
  const [localM3uEntries, setLocalM3uEntries] = useState<Array<{ title: string; url: string; tvgId?: string; tvgName?: string; tvgLogo?: string; groupTitle?: string; duration?: number }>>([]);
  const [localM3uSource, setLocalM3uSource] = useState('');

  useEffect(() => {
    writeRecentlyPlayed(recentlyPlayed);
  }, [recentlyPlayed]);

  const navigateTo = useCallback((dest: Destination) => {
    setDestination(dest);
    if (typeof window !== 'undefined') window.location.hash = dest === 'home' ? '' : `#${dest}`;
  }, []);

  useEffect(() => {
    const handleHashChange = () => setDestination(getDestinationFromHash());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const handlePlayProgram = useCallback<PlayProgramCallback>((
    archivePath, title, subtitle, mediaType, channelId, guideId, programId, sourceId, assetId
  ) => {
    const rawReference = String(archivePath ?? '').trim();
    if (!rawReference) {
      console.warn('[AJN Playback] refused empty media reference', { title, channelId, guideId, programId, assetId });
      return;
    }

    const constructedSrc = toPlayableSrc(rawReference);
    const inferredMediaType = mediaType || (
      rawReference.toLowerCase().endsWith('.mp3') || rawReference.toLowerCase().includes('audio') ? 'audio' : 'video'
    );

    const id = mediaIdentity({
      src: constructedSrc,
      archivePath: rawReference,
      programId,
      sourceId,
      assetId,
    });

    const nextRecentlyPlayed: RecentlyPlayedItem = {
      id,
      src: constructedSrc,
      title,
      subtitle,
      mediaType: inferredMediaType,
      channelId,
      guideId,
      programId,
      sourceId,
      assetId,
      archivePath: rawReference,
      progressSeconds: recentlyPlayed.find((item) => item.id === id)?.progressSeconds ?? 0,
      updatedAt: Date.now(),
    };

    setRecentlyPlayed((items) => [nextRecentlyPlayed, ...items.filter((item) => item.id !== id)].slice(0, RECENTLY_PLAYED_LIMIT));

    setNowPlaying({ ...nextRecentlyPlayed });
    setDestination('player');
    if (typeof window !== 'undefined') window.location.hash = '#player';
  }, [recentlyPlayed]);

  const handleEpgSelect: PlayProgramCallback = useCallback((
    archivePath, title, subtitle, mediaType, channelId, guideId, programId, sourceId, assetId
  ) => {
    handlePlayProgram(archivePath, title, subtitle || 'Live EPG Schedule', mediaType, channelId, guideId, programId, sourceId, assetId);
  }, [handlePlayProgram]);

  const updateRecentlyPlayedProgress = useCallback((itemId: string, positionSeconds: number) => {
    if (!Number.isFinite(positionSeconds) || positionSeconds < 0) return;
    setRecentlyPlayed((items) => items.map((item) => item.id === itemId ? { ...item, progressSeconds: positionSeconds, updatedAt: Date.now() } : item));
  }, []);

  const resumeRecentlyPlayed = useCallback((item: RecentlyPlayedItem) => {
    setNowPlaying(item);
    setRecentlyPlayed((items) => [item, ...items.filter((candidate) => candidate.id !== item.id)].slice(0, RECENTLY_PLAYED_LIMIT));
    setDestination('player');
    if (typeof window !== 'undefined') window.location.hash = '#player';
  }, []);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col selection:bg-sky-500/30 selection:text-sky-200">
      <Navigation currentDestination={destination} onNavigate={navigateTo} nowPlaying={nowPlaying} />
      <main id="canonical-main-viewport" className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8">
        {destination === 'home' && (
          <>
            <HomeView
              onNavigate={navigateTo}
              onPlayProgram={handlePlayProgram}
              nowPlaying={nowPlaying}
              recentlyPlayed={recentlyPlayed}
              onResumeRecentlyPlayed={resumeRecentlyPlayed}
            />
            <AjnResourcePanel onPlayProgram={handlePlayProgram} />
            <LocalMediaPanel onPlayProgram={handlePlayProgram} onM3uEntries={(entries, sourceName) => { setLocalM3uEntries(entries); setLocalM3uSource(sourceName); }} />
            {localM3uEntries.length > 0 && (
              <section className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-neutral-100">Local M3U Entries</h2>
                    <p className="text-xs text-neutral-400">{localM3uSource} · {localM3uEntries.length} entries</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {localM3uEntries.map((entry, index) => (
                    <button key={entry.tvgId || entry.url || index} type="button" onClick={() => handlePlayProgram(entry.url, entry.tvgName || entry.title, entry.groupTitle || 'Local M3U', 'video', entry.tvgId, 'local-m3u', entry.tvgId || entry.url)} className="rounded-lg border border-neutral-800 bg-neutral-950/70 p-3 text-left hover:border-neutral-700">
                      <span className="block truncate text-xs font-medium text-neutral-100">{entry.tvgName || entry.title}</span>
                      <span className="mt-1 block truncate text-[10px] text-neutral-500">{entry.groupTitle || 'Local M3U'}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
        {destination === 'tv-guide' && <TvGuideView onSelectProgram={handleEpgSelect} />}
        {destination === 'player' && <PlayerView nowPlaying={nowPlaying} onSelectProgram={handlePlayProgram} onNavigate={navigateTo} recentlyPlayed={recentlyPlayed} onProgress={updateRecentlyPlayedProgress} />}
        {destination === 'library' && <LibraryView onPlayProgram={handlePlayProgram} />}
        {destination === 'search' && <SearchView onPlayProgram={handlePlayProgram} />}
        {destination === 'dev' && <DevModeView onNavigate={navigateTo} />}
      </main>
      {nowPlaying && destination !== 'player' && (
        <MiniPlayerDock nowPlaying={nowPlaying} onOpenFullPlayer={() => navigateTo('player')} onDismiss={() => setNowPlaying(null)} />
      )}
    </div>
  );
}
