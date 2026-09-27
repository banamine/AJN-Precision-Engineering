import { useState, useEffect, useCallback } from 'react';
import { Destination, NowPlayingMedia, PlayProgramCallback } from './types';
import { Navigation } from './components/Navigation';
import { HomeView } from './components/HomeView';
import { TvGuideView } from './components/TvGuideView';
import { PlayerView } from './components/PlayerView';
import { LibraryView } from './components/LibraryView';
import { SearchView } from './components/SearchView';
// import { DevModeView } from './components/DevModeView';components/DevModeView';
import { MiniPlayerDock } from './components/MiniPlayerDock';
import { NewsTicker } from './components/NewsTicker';
import { fetchAjnRssNews, type AjnRssItem } from './services/AjnRssService';

const ARCHIVE_PROXY_BASE = '/api/archive/proxy?path=';
const ARCHIVE_DOWNLOAD_PREFIX = '/download/';

/** Resolve a media reference to exactly one playable transport URL. */
export function toPlayableSrc(rawPath: string): string {
  const value = String(rawPath ?? '').trim();
  if (!value) return rawPath;

  // Never double-proxy a path that is already routed through our proxy.
  if (value.startsWith(ARCHIVE_PROXY_BASE)) return rawPath;

  try {
    const origin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'http://localhost';
    const parsed = new URL(value, origin);

    // Explicitly check if the parsed URL has a valid protocol (like http or https)
    // before attempting to process it, returning the original path if the protocol is missing or invalid.
    const validProtocols = ['http:', 'https:'];
    if (!parsed.protocol || !validProtocols.includes(parsed.protocol.toLowerCase())) {
      return rawPath;
    }

    // Collapse absolute same-app proxy URLs to a relative URL.
    if (parsed.pathname === '/api/archive/proxy' && parsed.searchParams.has('path')) {
      return `${parsed.pathname}${parsed.search}`;
    }

    // Convert Google Drive sharing links into direct stream/download URLs.
    if (parsed.hostname === 'drive.google.com') {
      const driveMatch = parsed.pathname.match(/^\/file\/d\/([a-zA-Z0-9_-]+)/);
      const fileId = driveMatch ? driveMatch[1] : parsed.searchParams.get('id');
      if (fileId) {
        return `https://drive.google.com/uc?export=download&id=${fileId}`;
      }
    }

    // Canonicalize direct Archive.org downloads through the local proxy.
    if (parsed.hostname === 'archive.org' && parsed.pathname.startsWith(ARCHIVE_DOWNLOAD_PREFIX)) {
      const archivePath = `${parsed.pathname}${parsed.search}`;
      return `${ARCHIVE_PROXY_BASE}${encodeURIComponent(archivePath)}`;
    }
  } catch {
    // Preserve the original path if parsing fails instead of returning the failed string
    return rawPath;
  }

  if (value.startsWith(ARCHIVE_DOWNLOAD_PREFIX)) {
    return `${ARCHIVE_PROXY_BASE}${encodeURIComponent(value)}`;
  }

  // Remote HLS/DASH/MP4 and other non-Archive media remain direct.
  return rawPath;
}

type PlaybackIdentity = {
  titleId: string;
  routeId: string;
  playbackId: string;
};

type TraceableNowPlayingMedia = NowPlayingMedia & PlaybackIdentity;

/**
 * Stable, deterministic ID for catalog/tracing entities.
 * Permanent IDs are derived from canonical input and therefore survive reloads.
 */
function stableTraceId(prefix: string, ...parts: Array<string | null | undefined>): string {
  const canonical = parts
    .map((part) => String(part ?? '').trim().toLowerCase())
    .join('|');

  let hash = 2166136261;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return `${prefix}-${(hash >>> 0).toString(36).padStart(7, '0')}`;
}

function classifyPlaybackRoute(playableSrc: string): string {
  try {
    const parsed = new URL(
      playableSrc,
      typeof window !== 'undefined' ? window.location.origin : 'http://localhost',
    );

    if (parsed.pathname === '/api/archive/proxy') return 'archive-proxy';
    if (parsed.hostname === 'archive.org') return 'archive-direct';
    if (parsed.hostname === 'drive.google.com') return 'google-drive';
    if (parsed.pathname.endsWith('.m3u8')) return 'hls-direct';
    if (parsed.pathname.endsWith('.mp4')) return 'mp4-direct';
    if (parsed.pathname.endsWith('.mp3')) return 'mp3-direct';
    return 'remote-media';
  } catch {
    return 'media-reference';
  }
}

let playbackSequence = 0;

function buildPlaybackIdentity(
  archivePath: string,
  playableSrc: string,
  title: string,
  channelId?: string,
  guideId?: string,
  programId?: string,
  sourceId?: string,
  assetId?: string,
): PlaybackIdentity & {
  resolvedProgramId: string;
  resolvedSourceId: string;
  resolvedAssetId: string;
} {
  const resolvedChannelId = channelId?.trim() || stableTraceId('channel', title, archivePath);
  const resolvedGuideId = guideId?.trim() || 'guide-unknown';
  const resolvedProgramId =
    programId?.trim() ||
    stableTraceId('program', resolvedChannelId, resolvedGuideId, title);

  const resolvedTitleId = stableTraceId('title', title);
  const resolvedAssetId =
    assetId?.trim() ||
    stableTraceId('asset', resolvedChannelId, resolvedProgramId, archivePath);

  const resolvedSourceId =
    sourceId?.trim() ||
    stableTraceId('source', resolvedAssetId, archivePath);

  const routeKey = classifyPlaybackRoute(playableSrc);
  const routeId = stableTraceId('route', routeKey);

  // A playback ID represents one activation, so it is intentionally unique per play.
  playbackSequence += 1;
  const playbackId = `play-${Date.now().toString(36)}-${playbackSequence.toString(36)}`;

  return {
    titleId: resolvedTitleId,
    routeId,
    playbackId,
    resolvedProgramId,
    resolvedSourceId,
    resolvedAssetId,
  };
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
  const [nowPlaying, setNowPlaying] = useState<TraceableNowPlayingMedia | null>(null);
  const [newsItems, setNewsItems] = useState<AjnRssItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [newsFetchedAt, setNewsFetchedAt] = useState<string | null>(null);

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
    const rawReference = String(archivePath ?? '').trim();
    if (!rawReference) {
      console.warn('[AJN Playback] refused empty media reference', { title, channelId, guideId, programId, assetId });
      return;
    }

    const constructedSrc = toPlayableSrc(rawReference);
    const inferredMediaType =
      mediaType || (archivePath.toLowerCase().endsWith('.mp3') || archivePath.toLowerCase().includes('audio') ? 'audio' : 'video');

    const identity = buildPlaybackIdentity(
      rawReference,
      constructedSrc,
      title,
      channelId,
      guideId,
      programId,
      sourceId,
      assetId,
    );

    const resolvedChannelId =
      channelId?.trim() || stableTraceId('channel', title, rawReference);

    console.log('[AJN Playback Activation]', {
      archivePath: rawReference,
      constructedSrc,
      title,
      subtitle,
      mediaType: inferredMediaType,
      channelId: resolvedChannelId,
      guideId,
      programId: identity.resolvedProgramId,
      titleId: identity.titleId,
      sourceId: identity.resolvedSourceId,
      assetId: identity.resolvedAssetId,
      routeId: identity.routeId,
      playbackId: identity.playbackId,
    });

    setNowPlaying({
      src: constructedSrc,
      title,
      subtitle,
      archivePath: rawReference,
      mediaType: inferredMediaType,
      channelId: resolvedChannelId,
      guideId,
      programId: identity.resolvedProgramId,
      sourceId: identity.resolvedSourceId,
      assetId: identity.resolvedAssetId,
      titleId: identity.titleId,
      routeId: identity.routeId,
      playbackId: identity.playbackId,
    });

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ajn-playback-identity', {
        detail: {
          channelId: resolvedChannelId,
          guideId,
          programId: identity.resolvedProgramId,
          titleId: identity.titleId,
          sourceId: identity.resolvedSourceId,
          assetId: identity.resolvedAssetId,
          routeId: identity.routeId,
          playbackId: identity.playbackId,
          src: constructedSrc,
          mediaType: inferredMediaType,
        },
      }));
    }
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

  // Background RSS refresh. The browser consumes normalized AJN data from
  // the authoritative backend rather than fetching third-party feeds directly.
  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;

    const refreshNews = async () => {
      controller?.abort();
      controller = new AbortController();

      try {
        setNewsLoading(true);
        const snapshot = await fetchAjnRssNews({
          fresh: true,
          limit: 15,
          signal: controller.signal,
        });
        if (!active) return;
        setNewsItems(snapshot.items);
        setNewsFetchedAt(snapshot.fetchedAt);
        setNewsError(snapshot.errors.length ? snapshot.errors[0].message : null);
      } catch (error) {
        if (!active || (error instanceof DOMException && error.name === "AbortError")) return;
        setNewsError(error instanceof Error ? error.message : "News refresh failed.");
      } finally {
        if (active) setNewsLoading(false);
      }
    };

    void refreshNews();
    const manualRefresh = () => void refreshNews();
    window.addEventListener("ajn-news-refresh-requested", manualRefresh);
    const timer = window.setInterval(() => void refreshNews(), 5 * 60 * 1000);

    return () => {
      window.removeEventListener("ajn-news-refresh-requested", manualRefresh);
      active = false;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col selection:bg-sky-500/30 selection:text-sky-200">
      {/* ── Canonical Navigation Shell (Desktop topbar + Mobile bottom tab bar) ── */}
      <Navigation
        currentDestination={destination}
        onNavigate={navigateTo}
        nowPlaying={nowPlaying}
      />

      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4">
        <NewsTicker
          items={newsItems}
          loading={newsLoading}
          error={newsError}
          lastUpdated={newsFetchedAt}
          onRefresh={() => window.dispatchEvent(new Event("ajn-news-refresh-requested"))}
        />
      </div>

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
          <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-6 text-sm text-neutral-400">
            Developer diagnostics are available from the active player diagnostics surface.
          </div>
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
