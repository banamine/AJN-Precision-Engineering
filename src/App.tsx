import { lazy, Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { NewsReadyNotice } from './components/NewsReadyNotice';
import { Destination, NowPlayingMedia, RecentlyPlayedItem, PlayProgramCallback } from './types';
import { Navigation } from './components/Navigation';
import { HomeView } from './components/HomeView';
import { TvGuideView } from './components/TvGuideView';
import { TodayView } from './components/TodayView';
import { PlayerView } from './components/PlayerView';
import { LibraryView } from './components/LibraryView';
import { SearchView } from './components/SearchView';
import { NewsTabs as RumbleNewsWall } from './components/NewsTabs';
import { RadioView } from './components/RadioView';
import { DevModeView } from './components/DevModeView';
import { MiniPlayerDock } from './components/MiniPlayerDock';
import { RadioDock } from './components/RadioDock';
import { SyncedVideoPip } from './components/SyncedVideoPip';
import { useAvSyncRecorder } from './hooks/useAvSync';
import { toPlayableSrc } from './utils/playableSrc';
import { bridgeSrc } from './utils/mediaRoute';
import { HistoryView } from './components/HistoryView';
import { HistoryEntry, loadHistory, saveHistory, recordPlay, updateHistoryProgress, removeHistoryEntry } from './utils/historyStore';
import { FavoriteMedia, loadMediaFavorites, saveMediaFavorites, toggleFavorite, isFavorite as isMediaFavorite } from './utils/mediaFavorites';
import { useRadioFavorites, toggleRadioFavorite } from './utils/radioFavorites';
import { useCloudSync } from './hooks/useCloudSync';
import { buildSuggestCandidates, addRecentSearch, loadRecentSearches, saveRecentSearches } from './utils/suggest';
import { loadLastView, saveLastView, VALID_DESTINATIONS } from './nav/lastView';
import type { CubeArticle } from './news-cube/adapter';

const NewsCubePage = lazy(() => import('./news-cube/NewsCubePage'));

const RECENTLY_PLAYED_STORAGE_KEY = 'ajn.recentlyPlayed.v1';
const RECENTLY_PLAYED_LIMIT = 5;
const RESTORE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** The last audio item, ready but NOT playing, so a phone/Bluetooth Play press or one tap continues it after the app was
 *  closed or killed (e.g. the car was switched off). Null when there is none or it is older than a day. */
/** Live radio has no timeline: a saved "seconds listened" must never be used as a seek position. */
const isLiveRadioItem = (m: { channelId?: string; programId?: string; isLive?: boolean }): boolean =>
  Boolean(m.isLive) || String(m.channelId ?? '').startsWith('radio:') || String(m.programId ?? '').includes(':live:');

function restoreLastAudio(): NowPlayingMedia | null {
  const last = readRecentlyPlayed().find((i) => i.mediaType === 'audio' && Date.now() - i.updatedAt < RESTORE_MAX_AGE_MS);
  if (!last) return null;
  if (isLiveRadioItem(last)) return { ...last, startAtSeconds: undefined, restoredPaused: true };
  let at = last.progressSeconds;
  try {
    const saved = Number.parseFloat(window.localStorage.getItem(`ajn-playback-position:${last.programId ?? bridgeSrc(last.src)}`) ?? '');
    if (Number.isFinite(saved) && saved > 0) at = saved;
  } catch { /* storage unavailable: use the stored progress */ }
  return { ...last, startAtSeconds: at > 5 ? at : undefined, restoredPaused: true };
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
    case 'today': return 'today';
    case 'history': return 'history';
    case 'news': return 'news';
    case 'news-cube': return 'news-cube';
    case 'radio':
    case 'ajn-radio': return 'radio';
    case 'dev':
    case 'developer':
    case 'diagnostics': return 'dev';
    default: return 'home';
  }
}

function getInitialView(): { destination: Destination; fromStorage: boolean } {
  if (typeof window === 'undefined' || window.location.hash) {
    return { destination: getDestinationFromHash(), fromStorage: false };
  }
  const saved = loadLastView(VALID_DESTINATIONS);
  if (!saved) return { destination: 'home', fromStorage: false };
  const destination = saved.destination === 'player' || saved.destination === 'dev'
    ? 'home' : saved.destination as Destination;
  return { destination, fromStorage: true };
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
  const [initialView] = useState(getInitialView);
  const [destination, setDestination] = useState<Destination>(initialView.destination);
  const [hasVisitedTvGuide, setHasVisitedTvGuide] = useState(initialView.destination === 'tv-guide');
  // New page = start at the top. The TV Guide restores its own saved scroll position, so leave it alone.
  useEffect(() => {
    if (destination !== 'tv-guide') window.scrollTo(0, 0);
  }, [destination]);
  const [nowPlaying, setNowPlaying] = useState<NowPlayingMedia | null>(() => restoreLastAudio());
  const [externalSearch, setExternalSearch] = useState<{ q: string; n: number }>({ q: '', n: 0 });
  const [recentlyPlayed, setRecentlyPlayed] = useState<RecentlyPlayedItem[]>(() => readRecentlyPlayed());
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());
  const [favorites, setFavorites] = useState<FavoriteMedia[]>(() => loadMediaFavorites());
  const [recentSearches, setRecentSearches] = useState<string[]>(() => loadRecentSearches());

  // History is written at most once a second: playback progress updates it every few seconds.
  useEffect(() => {
    const t = window.setTimeout(() => saveHistory(history), 1000);
    return () => window.clearTimeout(t);
  }, [history]);
  useEffect(() => { saveMediaFavorites(favorites); }, [favorites]);
  useEffect(() => { saveRecentSearches(recentSearches); }, [recentSearches]);
  useEffect(() => {
    const flush = () => saveHistory(history);
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [history]);
  const sync = useCloudSync({ favorites, setFavorites, history, setHistory });
  const suggestCandidates = useMemo(
    () => buildSuggestCandidates(recentSearches, favorites.map((f) => f.title), history.map((h) => h.title)),
    [recentSearches, favorites, history],
  );
  const recordSearch = useCallback((q: string) => setRecentSearches((l) => addRecentSearch(l, q)), []);

  useEffect(() => {
    if (initialView.fromStorage) {
      window.location.hash = initialView.destination === 'home' ? '' : `#${initialView.destination}`;
    }
  }, [initialView]);

  useEffect(() => {
    writeRecentlyPlayed(recentlyPlayed);
  }, [recentlyPlayed]);

  const navigateTo = useCallback((dest: Destination) => {
    setDestination(dest);
    if (dest === 'tv-guide') setHasVisitedTvGuide(true);
    if (dest !== 'player' && dest !== 'dev') saveLastView({ destination: dest });
    if (typeof window !== 'undefined') window.location.hash = dest === 'home' ? '' : `#${dest}`;
  }, []);

  useEffect(() => {
    const handleHashChange = () => {
      const dest = getDestinationFromHash();
      setDestination(dest);
      if (dest === 'tv-guide') setHasVisitedTvGuide(true);
      if (dest !== 'player' && dest !== 'dev') saveLastView({ destination: dest });
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const stayOnPageRef = useRef(false);
  const handlePlayProgram = useCallback<PlayProgramCallback>((
    archivePath, title, subtitle, mediaType, channelId, guideId, programId, sourceId, assetId, startAtSeconds, bufferMetadata
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
    setHistory((h) => recordPlay(h, id, nextRecentlyPlayed, Date.now(), nextRecentlyPlayed.progressSeconds));

    // startAtSeconds is a one-shot instruction for this play only: it is not stored in recently played.
    setNowPlaying({ ...nextRecentlyPlayed, ...(bufferMetadata ? { bufferMetadata } : {}), ...(typeof startAtSeconds === 'number' && Number.isFinite(startAtSeconds) && startAtSeconds > 0 ? { startAtSeconds } : {}) });
    // Auto-advance (next clip/program) keeps the viewer where they are.
    if (stayOnPageRef.current) { stayOnPageRef.current = false; return; }
    setDestination('player');
    if (typeof window !== 'undefined') window.location.hash = '#player';
  }, [recentlyPlayed]);

  const handleAdvanceProgram = useCallback<PlayProgramCallback>((...args) => {
    stayOnPageRef.current = true;
    handlePlayProgram(...args);
  }, [handlePlayProgram]);

  const pauseExistingPlayerForCube = useCallback(() => {
    document.querySelector<HTMLMediaElement>('#persistent-player audio, #persistent-player video')?.pause();
  }, []);
  const startCubeArticlePlayback = useCallback((article: CubeArticle) => {
    const media = article.mediaReference;
    if (!media) return;
    // News Cube media, if introduced later, still enters the single App/player route.
    handlePlayProgram(media.src, article.title, article.publisherName, 'video');
  }, [handlePlayProgram]);

  const handleEpgSelect: PlayProgramCallback = useCallback((
    archivePath, title, subtitle, mediaType, channelId, guideId, programId, sourceId, assetId, startAtSeconds, bufferMetadata
  ) => {
    handlePlayProgram(archivePath, title, subtitle || 'Live EPG Schedule', mediaType, channelId, guideId, programId, sourceId, assetId, startAtSeconds, bufferMetadata);
  }, [handlePlayProgram]);

  const updateRecentlyPlayedProgress = useCallback((itemId: string, positionSeconds: number) => {
    if (!Number.isFinite(positionSeconds) || positionSeconds < 0) return;
    setRecentlyPlayed((items) => items.map((item) => item.id === itemId ? { ...item, progressSeconds: positionSeconds, updatedAt: Date.now() } : item));
    setHistory((h) => updateHistoryProgress(h, itemId, positionSeconds));
  }, []);

  const resumeRecentlyPlayed = useCallback((item: RecentlyPlayedItem) => {
    setNowPlaying(item);
    setRecentlyPlayed((items) => [item, ...items.filter((candidate) => candidate.id !== item.id)].slice(0, RECENTLY_PLAYED_LIMIT));
    setHistory((h) => recordPlay(h, item.id, item, Date.now(), item.progressSeconds));
    setDestination('player');
    if (typeof window !== 'undefined') window.location.hash = '#player';
  }, []);

  /** Replay a History / Favorites row: same item, resuming where it left off (live items start live). */
  const playSaved = useCallback((entry: NowPlayingMedia & { id: string; progressSeconds?: number }) => {
    const { id, progressSeconds, ...media } = entry as any;
    const at = typeof progressSeconds === 'number' && progressSeconds >= 5 && !isLiveRadioItem(media) ? progressSeconds : undefined;
    const item: RecentlyPlayedItem = { ...media, id, progressSeconds: progressSeconds ?? 0, updatedAt: Date.now() };
    delete (item as any).savedAt; delete (item as any).playedAt; delete (item as any).plays;
    setNowPlaying({ ...item, ...(at ? { startAtSeconds: at } : {}) });
    setRecentlyPlayed((items) => [item, ...items.filter((c) => c.id !== id)].slice(0, RECENTLY_PLAYED_LIMIT));
    setHistory((h) => recordPlay(h, id, item, Date.now(), item.progressSeconds));
    setDestination('player');
    if (typeof window !== 'undefined') window.location.hash = '#player';
  }, []);
  const nowPlayingId = nowPlaying ? mediaIdentity(nowPlaying) : null;
  const radioFavs = useRadioFavorites();
  const radioStationId = nowPlaying?.channelId && nowPlaying.channelId.startsWith('radio:') ? nowPlaying.channelId : null;
  const nowPlayingIsFavorite = radioStationId ? radioFavs.has(radioStationId) : (nowPlayingId ? isMediaFavorite(favorites, nowPlayingId) : false);
  const toggleNowPlayingFavorite = useCallback(() => {
    if (!nowPlaying) return;
    // Radio stations live in the one radio favorites list (same as the Radio directory hearts).
    if (nowPlaying.channelId && nowPlaying.channelId.startsWith('radio:')) { toggleRadioFavorite(nowPlaying.channelId); return; }
    const id = mediaIdentity(nowPlaying);
    setFavorites((list) => { const r = toggleFavorite(list, id, nowPlaying, Date.now()); if (!r.added && isMediaFavorite(list, id)) sync.noteFavoriteRemoved(id); return r.list; });
  }, [nowPlaying, sync]);

  useAvSyncRecorder(nowPlaying);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col selection:bg-sky-500/30 selection:text-sky-200">
      <Navigation currentDestination={destination} onNavigate={navigateTo} nowPlaying={nowPlaying} suggestions={suggestCandidates} onSearch={(q) => { recordSearch(q); setExternalSearch((prev) => ({ q, n: prev.n + 1 })); navigateTo('search'); }} />
      <main id="canonical-main-viewport" className="flex-1 w-full max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pt-4 sm:pt-8 pb-20 md:pb-8">
        {destination === 'home' && (
          <div key="view-home" className="view-fade-in w-full">
            <HomeView
              onNavigate={navigateTo}
              onPlayProgram={handlePlayProgram}
              nowPlaying={nowPlaying}
              recentlyPlayed={recentlyPlayed}
              onResumeRecentlyPlayed={resumeRecentlyPlayed}
              favorites={favorites}
              onPlayFavorite={playSaved}
            />
          </div>
        )}
        {hasVisitedTvGuide && (
          <div key="view-tv-guide" hidden={destination !== 'tv-guide'} className="view-fade-in w-full">
            <TvGuideView onSelectProgram={handleEpgSelect} onNavigate={navigateTo} active={destination === 'tv-guide'} />
          </div>
        )}
        {/* The player stays mounted while you browse other pages, so audio keeps
            playing in the background; the mini dock is its on-page control. */}
        {nowPlaying ? (
          <div
            id="persistent-player"
            hidden={destination !== 'player'}
            className={`w-full ${destination === 'player' ? 'view-fade-in' : ''}`}
          >
            <PlayerView nowPlaying={nowPlaying} onSelectProgram={handleAdvanceProgram} onNavigate={navigateTo} recentlyPlayed={recentlyPlayed} onProgress={updateRecentlyPlayedProgress} isFavorite={nowPlayingIsFavorite} onToggleFavorite={toggleNowPlayingFavorite} />
          </div>
        ) : destination === 'player' && (
          <div key="view-player" className="view-fade-in w-full">
            <PlayerView nowPlaying={nowPlaying} onSelectProgram={handleAdvanceProgram} onNavigate={navigateTo} recentlyPlayed={recentlyPlayed} onProgress={updateRecentlyPlayedProgress} isFavorite={nowPlayingIsFavorite} onToggleFavorite={toggleNowPlayingFavorite} />
          </div>
        )}
        {destination === 'today' && (
          <div key="view-today" className="view-fade-in w-full">
            <TodayView onSelectProgram={handleEpgSelect} onNavigate={navigateTo} />
          </div>
        )}
        {destination === 'library' && (
          <div key="view-library" className="view-fade-in w-full">
            <LibraryView onPlayProgram={handlePlayProgram} />
          </div>
        )}
        {destination === 'search' && (
          <div key="view-search" className="view-fade-in w-full">
            <SearchView onPlayProgram={handlePlayProgram} externalQuery={externalSearch} suggestions={suggestCandidates} onRecordSearch={recordSearch} />
          </div>
        )}
        {destination === 'news' && (
          <div key="view-news" className="view-fade-in w-full">
            <RumbleNewsWall />
          </div>
        )}
        {destination === 'news-cube' && (
          <div key="view-news-cube" className="view-fade-in w-full">
            <Suspense fallback={<p role="status" className="text-sm text-neutral-400">Loading News Cube…</p>}>
              <NewsCubePage
                startExistingPlayback={startCubeArticlePlayback}
                stopExistingPlayback={pauseExistingPlayerForCube}
              />
            </Suspense>
          </div>
        )}
        {destination === 'radio' && (
          <div key="view-radio" className="view-fade-in w-full">
            <RadioView onPlayProgram={handleAdvanceProgram} nowPlaying={nowPlaying} recentlyPlayed={recentlyPlayed} onNavigate={navigateTo} />
          </div>
        )}
        {destination === 'history' && (
          <div key="view-history" className="view-fade-in w-full">
            <HistoryView
              entries={history}
              onPlay={playSaved}
              onRemove={(id) => { sync.noteHistoryRemoved(id); setHistory((h) => removeHistoryEntry(h, id)); }}
              onClear={() => { sync.noteHistoryCleared(); setHistory([]); }}
              sync={sync}
              isFavorite={(id) => isMediaFavorite(favorites, id)}
            />
          </div>
        )}
        {destination === 'dev' && (
          <div key="view-dev" className="view-fade-in w-full">
            <DevModeView onNavigate={navigateTo} />
          </div>
        )}
      </main>
      <NewsReadyNotice onPlay={handlePlayProgram} />
      <RadioDock nowPlaying={nowPlaying} onPlay={handleAdvanceProgram} onNavigate={navigateTo} miniPlayerShowing={Boolean(nowPlaying) && destination !== 'player'} />
      <SyncedVideoPip nowPlaying={nowPlaying} onPlay={handleAdvanceProgram} onNavigate={navigateTo} />
      {nowPlaying && destination !== 'player' && (
        <MiniPlayerDock nowPlaying={nowPlaying} onOpenFullPlayer={() => navigateTo('player')} onDismiss={() => setNowPlaying(null)} onPlayProgram={handleAdvanceProgram} onNavigate={navigateTo} />
      )}
    </div>
  );
}
