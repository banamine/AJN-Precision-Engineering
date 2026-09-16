import { useEffect, useState, useCallback } from 'react';
import { Destination, NowPlayingMedia, PlayProgramCallback } from './types';
import { Navigation } from './components/Navigation';
import { HomeView } from './components/HomeView';
import { TvGuideView } from './components/TvGuideView';
import { PlayerView } from './components/PlayerView';
import { LibraryView } from './components/LibraryView';
import { SearchView } from './components/SearchView';
import { DevModeView } from './components/DevModeView';
import { MiniPlayerDock } from './components/MiniPlayerDock';
import { NewsViewer } from './components/NewsViewer';
import { NEWS_VIEWER_FIXTURE } from './components/NewsViewerFixture';

const ARCHIVE_PROXY_BASE = '/api/archive/proxy?path=';
const ARCHIVE_DOWNLOAD_PREFIX = '/download/';

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
  const [isNewsFixtureOpen, setIsNewsFixtureOpen] = useState(false);

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
    const rawReference = String(archivePath ?? '').trim();
    if (!rawReference) {
      console.warn('[AJN Playback] refused empty media reference', { title, channelId, guideId, programId, assetId });
      return;
    }

    const constructedSrc = toPlayableSrc(rawReference);
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
      archivePath: rawReference,
      mediaType: inferredMediaType,
      channelId,
      guideId,
      programId,
      sourceId,
      assetId
    });
    setDestination('player');
    if (typeof window !== 'undefined') {
      window.location.hash = '#player';
    }
  }, []);

  const handleEpgSelect: PlayProgramCallback = useCallback((archivePath, title, subtitle, mediaType, channelId, guideId, programId, sourceId, assetId) => {
    handlePlayProgram(archivePath, title, subtitle || 'Live EPG Schedule', mediaType, channelId, guideId, programId, sourceId, assetId);
  }, [handlePlayProgram]);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col selection:bg-sky-500/30 selection:text-sky-200">
      <Navigation
        currentDestination={destination}
        onNavigate={navigateTo}
        nowPlaying={nowPlaying}
      />

      <main
        id="canonical-main-viewport"
        className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8"
      >
        {destination === 'home' && (
          <HomeView
            onNavigate={navigateTo}
            onPlayProgram={handlePlayProgram}
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

      {nowPlaying && destination !== 'player' && (
        <MiniPlayerDock
          nowPlaying={nowPlaying}
          onOpenFullPlayer={() => navigateTo('player')}
          onDismiss={() => setNowPlaying(null)}
        />
      )}

      <button
        id="news-viewer-fixture-trigger"
        type="button"
        onClick={() => setIsNewsFixtureOpen(true)}
        className="fixed bottom-20 left-4 z-40 rounded-lg border border-neutral-700 bg-neutral-900/95 px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-sky-400 shadow-xl backdrop-blur-md transition hover:border-sky-500/40 hover:text-sky-300"
        title="Open controlled News Viewer layout fixture"
      >
        Preview News
      </button>

      {isNewsFixtureOpen && (
        <NewsViewer
          article={NEWS_VIEWER_FIXTURE}
          onClose={() => setIsNewsFixtureOpen(false)}
        />
      )}
    </div>
  );
}
