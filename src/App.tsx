import { useState, useEffect, useCallback } from 'react';
import { Destination, NowPlayingMedia, PlayProgramCallback } from './types';
import { Navigation } from './components/Navigation';
import { HomeView } from './components/HomeView';
import { TvGuideView } from './components/TvGuideView';
import { PlayerView } from './components/PlayerView';
import { LibraryView } from './components/LibraryView';
import { SearchView } from './components/SearchView';
import { DevModeView } from './components/DevModeView';
import { MiniPlayerDock } from './components/MiniPlayerDock';

const ARCHIVE_PROXY_BASE = '/api/archive/proxy?path=';

function getDestinationFromHash(): Destination {
  if (typeof window === 'undefined') return 'home';
  const hash = window.location.hash.replace('#', '').toLowerCase();
  switch (hash) {
    case 'tv-guide':
    case 'guide':
    case 'epg':
      return 'tv-guide';
    case 'player':
    case 'watch':
      return 'player';
    case 'library':
    case 'archive':
      return 'library';
    case 'search':
      return 'search';
    case 'dev':
    case 'developer':
    case 'diagnostics':
      return 'dev';
    default:
      return 'home';
  }
}

export default function App() {
  const [destination, setDestination] = useState<Destination>(() => getDestinationFromHash());
  const [nowPlaying, setNowPlaying] = useState<NowPlayingMedia | null>(null);

  // Sync destination with URL hash
  const navigateTo = useCallback((dest: Destination) => {
    setDestination(dest);
    if (typeof window !== 'undefined') {
      window.location.hash = dest === 'home' ? '' : `#${dest}`;
    }
  }, []);

  useEffect(() => {
    const handleHashChange = () => {
      const dest = getDestinationFromHash();
      setDestination(dest);
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Shared playback activation — updates state & routes into Player
  const handlePlayProgram = useCallback<PlayProgramCallback>((
    archivePath,
    title,
    subtitle,
    mediaType,
    channelId,
    guideId,
    programId,
    sourceId,
    assetId
  ) => {


    const constructedSrc = `${ARCHIVE_PROXY_BASE}${encodeURIComponent(archivePath)}`;
    const inferredMediaType =
      mediaType || (archivePath.toLowerCase().endsWith('.mp3') || archivePath.toLowerCase().includes('audio') ? 'audio' : 'video');

    console.log('[AJN Playback Activation]', {
      archivePath,
      constructedSrc,
      title,
      subtitle,
      mediaType: inferredMediaType,
      channelId,
      guideId
    });
    setNowPlaying({
      src: constructedSrc,
      title,
      subtitle,
      archivePath,
      mediaType: inferredMediaType,
      channelId,
      guideId,
      programId,
      sourceId,
      assetId
    });
    // Open full player view on direct selection
    setDestination('player');
    if (typeof window !== 'undefined') {
      window.location.hash = '#player';
    }
  }, []);

  // Handle program selection from EPG Guide
  const handleEpgSelect: PlayProgramCallback = useCallback((archivePath, title, subtitle, mediaType, channelId, guideId, programId, sourceId, assetId) => {
    handlePlayProgram(archivePath, title, subtitle || 'Live EPG Schedule', mediaType, channelId, guideId, programId, sourceId, assetId);
  }, [handlePlayProgram]);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col selection:bg-sky-500/30 selection:text-sky-200">
      {/* ── Canonical Navigation Shell (Desktop topbar + Mobile bottom tab bar) ── */}
      <Navigation
        currentDestination={destination}
        onNavigate={navigateTo}
        nowPlaying={nowPlaying}
      />

      {/* ── Active Destination Viewport ── */}
      <main
        id="canonical-main-viewport"
        className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8"
      >
        {destination === 'home' && (
          <HomeView
            onNavigate={navigateTo}
            onPlayProgram={handlePlayProgram}
            nowPlaying={nowPlaying}
          />
        )}

        {destination === 'tv-guide' && (
          <TvGuideView onSelectProgram={handleEpgSelect} />
        )}

        {destination === 'player' && (
          <PlayerView
            nowPlaying={nowPlaying}
            onSelectProgram={handlePlayProgram}
            onNavigate={navigateTo}
          />
        )}

        {destination === 'library' && (
          <LibraryView onPlayProgram={handlePlayProgram} />
        )}

        {destination === 'search' && (
          <SearchView onPlayProgram={handlePlayProgram} />
        )}

        {destination === 'dev' && (
          <DevModeView onNavigate={navigateTo} />
        )}
      </main>

      {/* ── Persistent Mini Player Dock (when playing & outside full player view) ── */}
      {nowPlaying && destination !== 'player' && (
        <MiniPlayerDock
          nowPlaying={nowPlaying}
          onOpenFullPlayer={() => navigateTo('player')}
          onDismiss={() => setNowPlaying(null)}
        />
      )}
    </div>
  );
}
