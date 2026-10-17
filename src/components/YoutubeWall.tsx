import { useEffect, useRef, useState } from 'react';
import playlistCatalogSeed from '../data/youtubePlaylists.json';
import type {
  YoutubeChannel,
  YoutubeChannelRegistry,
  YoutubeFailure,
  YoutubeLatestResponse,
  YoutubePlaylist,
  YoutubePlaylistCatalog,
  YoutubePlaylistCatalogChannel,
  YoutubePlaylistResolveResponse,
} from '../youtube/types';
import {
  isAllowedYoutubeUrl,
  isYoutubePlaylist,
  isYoutubePlaylistId,
  isYoutubeVideoId,
  parseYoutubePlaylistId,
  validateYoutubeLatestResponse,
  validateYoutubePanels,
  validateYoutubePlaylistCatalog,
  validateYoutubePlaylistResolveResponse,
  validateYoutubeRegistry,
} from '../youtube/validate';
import { resolveNewsOnServer } from '../news/client';
import { RESOLVE_FAILURE_TEXT } from '../news/contract';
import type { ResolvedMedia } from '../news/contract';
import { parseNewsInput } from '../news/registry';
import { youtubeProvider } from '../news/providers/youtube';
import { pickRandomChannels } from '../youtube/pick';
import { loadAddedShows, loadPanelPicks, saveAddedShow, savePanelPicks } from '../youtube/panelMemory';

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLIFrameElement,
        options: {
          /** Must match the embed's origin: with youtube-nocookie.com embeds the default host (www.youtube.com)
           *  makes the API's postMessage throw "target origin ... does not match the recipient window's origin". */
          host?: string;
          events: {
            onReady?: (event: { target: YoutubePlayer }) => void;
            onError?: (event: { data: number }) => void;
            onStateChange?: (event: { data: number; target: YoutubePlayer }) => void;
          };
        },
      ) => YoutubePlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YoutubePlayer {
  mute: () => void;
  isMuted: () => boolean;
  destroy: () => void;
  loadPlaylist: (options: { listType: 'playlist'; list: string; index?: number }) => void;
}

const YT_ENDED = 0;
const YT_HOST = 'https://www.youtube-nocookie.com';
/** A channel's "uploads" playlist id is its channel id with the UC prefix swapped for UU. */
export function uploadsPlaylistId(channelId: string): string | null {
  return /^UC[\w-]{22}$/.test(channelId) ? `UU${channelId.slice(2)}` : null;
}

interface WallVideo {
  kind: 'video' | 'playlist' | 'live';
  videoId: string;
  title: string;
  channelName: string;
  publishedAt: string | null;
  thumbnailUrl: string | null;
  asOf: string | null;
  staleReason: string | null;
  channelLookupId: string | null;
}

interface PanelState {
  selectedChannelId: string;
  video: WallVideo | null;
  latestVideo: WallVideo | null;
  error: string | null;
  busy: boolean;
  playing: boolean;
  openVideoId: string | null;
  activeTab: 'latest' | 'shows' | 'live';
  showListOpen: boolean;
  liveUnavailable: boolean;
}

export function selectYoutubeShowState(
  panel: PanelState,
  channel: YoutubeChannel,
  show: YoutubePlaylist,
): PanelState {
  return {
    ...panel,
    video: {
      kind: 'playlist',
      videoId: show.id,
      title: show.title,
      channelName: channel.name,
      publishedAt: null,
      thumbnailUrl: show.thumbnailUrl,
      asOf: null,
      staleReason: null,
      channelLookupId: null,
    },
    activeTab: 'shows',
    showListOpen: false,
    playing: true,
    busy: false,
    error: null,
    openVideoId: null,
    liveUnavailable: false,
  };
}

export function openYoutubeShowListState(panel: PanelState): PanelState {
  return {
    ...panel,
    activeTab: 'shows',
    showListOpen: true,
    playing: false,
    liveUnavailable: false,
    error: null,
  };
}

interface ChannelLookupOptions {
  staleRefresh?: boolean;
  expectedVideoId?: string;
}

const GROUPS = [
  { id: 'tv-wire', label: 'TV and wire news' },
  { id: 'commentary', label: 'Commentary' },
  { id: 'business', label: 'Business and finance' },
  { id: 'government-intl', label: 'Government and international' },
  { id: 'entertainment', label: 'Entertainment' },
] as const;

const PLAYLIST_CATALOG = playlistCatalogSeed as YoutubePlaylistCatalog;

const EMPTY_PANELS: PanelState[] = Array.from({ length: 4 }, () => ({
  selectedChannelId: '',
  video: null,
  latestVideo: null,
  error: null,
  busy: false,
  playing: false,
  openVideoId: null,
  activeTab: 'latest',
  showListOpen: false,
  liveUnavailable: false,
}));

const STALE_REFRESH_AFTER_MS = 10 * 60 * 1000;

const players = new Map<number, YoutubePlayer>();
const previousMutedState = new Map<number, boolean>();
let apiPromise: Promise<void> | null = null;
let muteCoordinator: number | null = null;

function registerPlayer(index: number, player: YoutubePlayer): void {
  player.mute();
  players.set(index, player);
  previousMutedState.set(index, true);
  if (muteCoordinator !== null) return;

  // The IFrame API exposes isMuted(), so one shared short poll coordinates audio
  // while players exist; the interval is removed with the final player.
  muteCoordinator = window.setInterval(() => {
    let newlyUnmuted: number | null = null;
    for (const [playerIndex, activePlayer] of players) {
      const muted = activePlayer.isMuted();
      if (previousMutedState.get(playerIndex) === true && !muted) {
        newlyUnmuted = playerIndex;
      }
      previousMutedState.set(playerIndex, muted);
    }
    if (newlyUnmuted === null) return;
    for (const [playerIndex, activePlayer] of players) {
      if (playerIndex === newlyUnmuted || activePlayer.isMuted()) continue;
      activePlayer.mute();
      previousMutedState.set(playerIndex, true);
    }
  }, 250);
}

function unregisterPlayer(index: number, player: YoutubePlayer): void {
  if (players.get(index) === player) players.delete(index);
  previousMutedState.delete(index);
  if (players.size > 0 || muteCoordinator === null) return;
  window.clearInterval(muteCoordinator);
  muteCoordinator = null;
  previousMutedState.clear();
}

function ensureYoutubeApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('YouTube player is unavailable.'));
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<void>((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    let timeoutId: number | undefined;
    let addedScript: HTMLScriptElement | null = null;
    let existingScript: HTMLScriptElement | null = null;
    let existingErrorHandler: (() => void) | null = null;
    const clearPendingListeners = () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      if (existingScript && existingErrorHandler) {
        existingScript.removeEventListener('error', existingErrorHandler);
      }
      if (addedScript) addedScript.onerror = null;
    };
    const restoreReadyHandler = (readyCallback: () => void) => {
      if (window.onYouTubeIframeAPIReady === readyCallback) {
        window.onYouTubeIframeAPIReady = previousReady;
      }
    };
    const fail = (readyCallback: () => void) => {
      clearPendingListeners();
      restoreReadyHandler(readyCallback);
      addedScript?.remove();
      apiPromise = null;
      reject(new Error('YouTube player API did not load.'));
    };
    const readyCallback = () => {
      try {
        previousReady?.();
      } catch {
        // Keep a prior consumer's failure from blocking our own readiness check.
      }
      clearPendingListeners();
      restoreReadyHandler(readyCallback);
      if (window.YT?.Player) resolve();
      else fail(readyCallback);
    };
    window.onYouTubeIframeAPIReady = readyCallback;
    timeoutId = window.setTimeout(() => {
      fail(readyCallback);
    }, 12000);

    existingScript = document.querySelector<HTMLScriptElement>('script[src="https://www.youtube.com/iframe_api"]');
    if (existingScript) {
      existingErrorHandler = () => fail(readyCallback);
      existingScript.addEventListener('error', existingErrorHandler, { once: true });
    } else {
      addedScript = document.createElement('script');
      addedScript.src = 'https://www.youtube.com/iframe_api';
      addedScript.async = true;
      addedScript.onerror = () => fail(readyCallback);
      document.head.appendChild(addedScript);
    }
  });
  return apiPromise;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Publication time unavailable';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    ? new Date(parsed).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'Publication time unavailable';
}

function officialVideoUrl(videoId: string | null): string {
  const candidate = videoId && isYoutubeVideoId(videoId)
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
    : 'https://www.youtube.com/';
  return isAllowedYoutubeUrl(candidate) ? candidate : 'https://www.youtube.com/';
}

function officialContentUrl(content: WallVideo | null): string {
  if (content?.kind === 'playlist' && isYoutubePlaylistId(content.videoId)) {
    const candidate = `https://www.youtube.com/playlist?list=${encodeURIComponent(content.videoId)}`;
    return isAllowedYoutubeUrl(candidate) ? candidate : 'https://www.youtube.com/';
  }
  return officialVideoUrl(content?.videoId ?? null);
}

function failureMessage(reason: string): string {
  return `${RESOLVE_FAILURE_TEXT[reason as keyof typeof RESOLVE_FAILURE_TEXT] ?? RESOLVE_FAILURE_TEXT['bad-response']}`;
}

function lastGoodFailureMessage(asOf: string | null): string {
  return `Couldn't load latest. Showing last loaded version (as of ${formatDate(asOf)}).`;
}

interface YoutubePanelProps {
  index: number;
  channels: YoutubeChannel[];
  catalog: YoutubePlaylistCatalogChannel | null;
  addedShows: YoutubePlaylist[];
  panel: PanelState;
  onPanelChange: (index: number, update: Partial<PanelState>) => void;
  onChooseChannel: (index: number, channelId: string) => void;
  onSubmitVideo: (index: number, value: string) => void;
  onSelectShow: (index: number, show: YoutubePlaylist) => void;
  onAddShow: (index: number, value: string) => void;
  onShowLatest: (index: number) => void;
  onShowLive: (index: number, channel: YoutubeChannel) => void;
}

export function YoutubePanel({
  index,
  channels,
  catalog,
  addedShows,
  panel,
  onPanelChange,
  onChooseChannel,
  onSubmitVideo,
  onSelectShow,
  onAddShow,
  onShowLatest,
  onShowLive,
}: YoutubePanelProps) {
  const mounted = useRef(false);
  const onPanelChangeRef = useRef(onPanelChange);
  const [showSearch, setShowSearch] = useState('');
  const [playlistUrl, setPlaylistUrl] = useState('');
  onPanelChangeRef.current = onPanelChange;
  const channelsRef = useRef(channels);
  channelsRef.current = channels;
  const lookupIdRef = useRef(panel.video?.channelLookupId);
  lookupIdRef.current = panel.video?.channelLookupId;

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    let player: YoutubePlayer | null = null;
    const videoId = panel.video?.videoId;
    const videoKind = panel.video?.kind;
    const iframe = panel.playing && videoId
      ? document.getElementById(`youtube-frame-${index}`) as HTMLIFrameElement | null
      : null;

    if (!iframe) {
      const previous = players.get(index);
      if (previous) {
        unregisterPlayer(index, previous);
        previous.destroy();
      }
    } else {
      void ensureYoutubeApi().then(() => {
        if (cancelled || !mounted.current || !window.YT?.Player) return;
        player = new window.YT.Player(iframe, {
          host: YT_HOST,
          events: {
            onReady: (event) => {
              if (cancelled) {
                event.target.destroy();
                return;
              }
              player = event.target;
              registerPlayer(index, event.target);
            },
            // Continuous playback: when a channel's single latest upload ends, keep going with that
            // channel's uploads (next newest first). Playlists and lives continue on their own.
            onStateChange: (event) => {
              if (cancelled || event.data !== YT_ENDED || videoKind !== 'video') return;
              const channel = channelsRef.current.find((c) => c.id === lookupIdRef.current);
              const list = channel ? uploadsPlaylistId(channel.channelId) : null;
              if (!list) return;
              try { event.target.loadPlaylist({ listType: 'playlist', list, index: 1 }); } catch { /* player gone */ }
            },
            onError: () => {
              if (cancelled || !videoKind) return;
              if (videoKind === 'live') {
                onPanelChangeRef.current(index, { liveUnavailable: true, playing: false, error: null });
              } else {
                onPanelChangeRef.current(index, { error: 'The selected YouTube item could not be loaded.' });
              }
            },
          },
        });
      }).catch(() => {
        if (!cancelled) onPanelChangeRef.current(index, { error: 'The YouTube player could not be loaded.' });
      });
    }

    return () => {
      cancelled = true;
      mounted.current = false;
      const current = player ?? players.get(index) ?? null;
      if (current) {
        unregisterPlayer(index, current);
        current.destroy();
      }
    };
  }, [index, panel.playing, panel.video?.videoId, panel.video?.kind]);

  const channelValue = channels.some((channel) => channel.id === panel.selectedChannelId)
    ? panel.selectedChannelId
    : '';
  const selectedChannel = channels.find((channel) => channel.id === panel.selectedChannelId) ?? null;
  const showItems = [...(catalog?.playlists ?? []), ...addedShows];
  const filteredShows = showItems.filter((show) => show.title.toLocaleLowerCase().includes(showSearch.trim().toLocaleLowerCase()));
  const ORIGIN = typeof window === 'undefined' ? '' : `&origin=${encodeURIComponent(window.location.origin)}`;
  const iframeSrc = panel.video?.kind === 'playlist'
    ? `https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(panel.video.videoId)}&autoplay=1&enablejsapi=1${ORIGIN}`
    : panel.video?.kind === 'live'
      ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(panel.video.videoId)}?autoplay=1&enablejsapi=1${ORIGIN}`
      : panel.video
        ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(panel.video.videoId)}?enablejsapi=1&playsinline=1&rel=0&mute=1${ORIGIN}`
        : '';

  return (
    <section
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900"
      aria-label={`YouTube panel ${index + 1}`}
      data-testid={`youtube-panel-${index + 1}`}
    >
      <header className="flex min-h-10 items-center justify-between gap-2 border-b border-neutral-800 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-300">YouTube / {String(index + 1).padStart(2, '0')}</span>
        {selectedChannel?.main ? (
          <div className="flex items-center gap-1" role="tablist" aria-label={`${selectedChannel.name} content`}>
            {([
              ['latest', 'Latest'],
              ['shows', 'Shows'],
              ['live', 'Live'],
            ] as const).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={panel.activeTab === tab}
                aria-label={tab === 'live' ? 'Live (unverified)' : label}
                onClick={() => {
                  if (tab === 'latest') onShowLatest(index);
                  else if (tab === 'live') onShowLive(index, selectedChannel);
                  else onPanelChange(index, openYoutubeShowListState(panel));
                }}
                className={`rounded px-2 py-1 text-[10px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                  panel.activeTab === tab
                    ? 'bg-sky-500/20 text-sky-200'
                    : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
                }`}
                data-testid={`tab-youtube-${tab}-${index + 1}`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : (
          <span className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[10px] uppercase text-neutral-500">latest uploads</span>
        )}
      </header>

      <div className="relative aspect-video w-full bg-neutral-950" data-testid={`youtube-player-area-${index + 1}`}>
        {panel.activeTab === 'shows' && panel.showListOpen && selectedChannel?.main ? (
          <div className="absolute inset-0 flex flex-col gap-2 overflow-y-auto p-3" data-testid={`youtube-shows-${index + 1}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-neutral-400" data-testid={`text-youtube-show-count-${index + 1}`}>
                {catalog?.completeness === 'partial'
                  ? `${catalog.playlists.length} shows found; list may be incomplete`
                  : `${catalog?.playlists.length ?? 0} shows found`}
              </p>
              <input
                value={showSearch}
                onChange={(event) => setShowSearch(event.target.value)}
                type="search"
                placeholder="Search shows"
                aria-label={`Search ${selectedChannel.name} shows`}
                className="min-w-0 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-[11px] text-neutral-200 placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                data-testid={`input-youtube-show-search-${index + 1}`}
              />
            </div>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {filteredShows.map((show) => (
                <button
                  key={show.id}
                  type="button"
                  onClick={() => onSelectShow(index, show)}
                  className="flex min-w-0 items-center gap-2 rounded-md border border-neutral-800 bg-neutral-900/70 p-1.5 text-left hover:border-neutral-600 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                  data-testid={`button-youtube-show-${show.id}`}
                >
                  <img src={show.thumbnailUrl} alt="" className="h-10 w-16 shrink-0 rounded object-cover" loading="lazy" />
                  <span className="line-clamp-2 text-[11px] font-medium leading-snug text-neutral-200">{show.title}</span>
                </button>
              ))}
              {filteredShows.length === 0 && (
                <p className="col-span-full py-2 text-center text-[11px] text-neutral-500" role="status">
                  {showItems.length === 0 ? 'No shows are available.' : 'No shows match this search.'}
                </p>
              )}
            </div>
            <form
              className="mt-auto flex items-center gap-2 border-t border-neutral-800 pt-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!playlistUrl.trim()) return;
                onAddShow(index, playlistUrl);
                setPlaylistUrl('');
              }}
            >
              <input
                value={playlistUrl}
                onChange={(event) => setPlaylistUrl(event.target.value)}
                type="url"
                inputMode="url"
                placeholder="Paste a YouTube playlist link"
                aria-label={`YouTube playlist link for ${selectedChannel.name}`}
                className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-[11px] text-neutral-200 placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                data-testid={`input-youtube-add-show-${index + 1}`}
              />
              <button
                type="submit"
                disabled={panel.busy}
                className="shrink-0 rounded-md border border-neutral-700 px-2 py-1.5 text-[11px] text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
                data-testid={`button-youtube-add-show-${index + 1}`}
              >
                {panel.busy ? 'Adding…' : 'Add show'}
              </button>
            </form>
          </div>
        ) : panel.video?.kind === 'live' && panel.liveUnavailable ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center" role="status" data-testid={`status-youtube-live-unavailable-${index + 1}`}>
            <span className="text-sm font-medium text-neutral-200">Not live right now</span>
            <button
              type="button"
              onClick={() => onShowLatest(index)}
              className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-sky-200 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
              data-testid={`button-youtube-live-latest-${index + 1}`}
            >
              Latest
            </button>
          </div>
        ) : panel.video && panel.playing ? (
          <iframe
            id={`youtube-frame-${index}`}
            src={iframeSrc}
            title={`${panel.video.kind === 'live' ? 'Live (unverified)' : panel.video.title} — YouTube`}
            className="absolute inset-0 h-full w-full border-0"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            data-testid={`youtube-iframe-${index + 1}`}
          />
        ) : panel.video ? (
          <button
            type="button"
            onClick={() => onPanelChange(index, { playing: true })}
            className="group absolute inset-0 flex w-full items-center justify-center overflow-hidden bg-neutral-950 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500"
            aria-label={`Load ${panel.video.title}`}
            data-testid={`button-load-youtube-${index + 1}`}
          >
            {panel.video.thumbnailUrl ? (
              <img
                src={panel.video.thumbnailUrl}
                alt=""
                className="absolute inset-0 h-full w-full object-cover opacity-75 transition-opacity group-hover:opacity-90"
                data-testid={`img-youtube-thumbnail-${index + 1}`}
              />
            ) : (
              <span className="absolute inset-0 bg-gradient-to-br from-neutral-800 to-neutral-950" />
            )}
            <span className="relative flex h-12 w-12 items-center justify-center rounded-full border border-white/70 bg-neutral-950/80 text-sm text-white shadow-lg">▶</span>
            <span className="sr-only">Click thumbnail to load the YouTube player</span>
          </button>
        ) : panel.busy ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-neutral-300" role="status" data-testid={`loading-youtube-panel-${index + 1}`}>
            Loading latest...
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-neutral-600" data-testid={`empty-youtube-panel-${index + 1}`}>
            <span className="font-mono text-[10px] uppercase tracking-[0.2em]">{panel.selectedChannelId ? 'No upload available' : 'No upload selected'}</span>
            <span className="text-xs text-neutral-400">{panel.selectedChannelId ? panel.error ?? 'No latest upload available' : 'Choose a channel'}</span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2.5 px-3 py-3">
        <select
          value={channelValue}
          onChange={(event) => onChooseChannel(index, event.target.value)}
          disabled={panel.busy}
          aria-label={`Channel for YouTube panel ${index + 1}`}
          className="min-w-0 w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-60"
          data-testid={`select-youtube-channel-${index + 1}`}
        >
          <option value="">Choose a channel</option>
          {GROUPS.map((group) => (
            <optgroup key={group.id} label={group.label}>
              {channels.filter((channel) => channel.group === group.id).map((channel) => (
                <option key={channel.id} value={channel.id}>{channel.name}</option>
              ))}
            </optgroup>
          ))}
        </select>

        {panel.video ? (
          <div className="min-w-0" data-testid={`youtube-video-details-${index + 1}`}>
            <p className="line-clamp-2 text-sm font-medium leading-snug text-neutral-100" title={panel.video.kind === 'live' ? 'Live (unverified)' : panel.video.title} data-testid={`text-youtube-title-${index + 1}`}>
              {panel.video.kind === 'live' ? 'Live (unverified)' : panel.video.title}
            </p>
            {panel.video.kind !== 'live' && (
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-neutral-400">
                <span className="truncate">{panel.video.channelName}</span>
                {panel.video.publishedAt && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{formatDate(panel.video.publishedAt)}</span>
                  </>
                )}
              </div>
            )}
            {panel.video.kind === 'video' && panel.video.asOf && (
              <p className="mt-1 font-mono text-[10px] text-neutral-500" data-testid={`text-youtube-asof-${index + 1}`}>
                as of {formatDate(panel.video.asOf)}
              </p>
            )}
          </div>
        ) : null}

        {panel.activeTab === 'latest' && (
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const input = event.currentTarget.elements.namedItem('youtube-input') as HTMLInputElement | null;
              if (input) onSubmitVideo(index, input.value);
            }}
          >
            <input
              name="youtube-input"
              type="text"
              placeholder="Paste a YouTube URL or video ID"
              aria-label={`YouTube URL or ID for panel ${index + 1}`}
              className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-200 placeholder:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
              data-testid={`input-youtube-url-${index + 1}`}
            />
            <button
              type="submit"
              disabled={panel.busy}
              className="shrink-0 rounded-md border border-neutral-700 px-2.5 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-60"
              data-testid={`button-resolve-youtube-${index + 1}`}
            >
              {panel.busy ? 'Checking…' : 'Go'}
            </button>
          </form>
        )}
        {panel.busy && <p className="text-[11px] text-neutral-500" role="status" data-testid={`status-youtube-loading-${index + 1}`}>{panel.activeTab === 'shows' ? 'Checking playlist…' : 'Checking newest upload…'}</p>}
        {panel.error && <p className="text-[11px] leading-relaxed text-red-400" role="alert" data-testid={`error-youtube-panel-${index + 1}`}>{panel.error}</p>}
        {(panel.video || panel.error) && (
          <a
            href={panel.openVideoId ? officialVideoUrl(panel.openVideoId) : officialContentUrl(panel.video)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex text-[11px] text-sky-300 underline decoration-sky-700 underline-offset-2 hover:text-sky-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            data-testid={`link-open-youtube-${index + 1}`}
          >
            Open on YouTube
          </a>
        )}
      </div>
    </section>
  );
}

export function YoutubeWall() {
  const [channels, setChannels] = useState<YoutubeChannel[]>([]);
  const [panels, setPanels] = useState<PanelState[]>(EMPTY_PANELS);
  const [addedShowsByChannel, setAddedShowsByChannel] = useState<Record<string, YoutubePlaylist[]>>({});
  const [registryStatus, setRegistryStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [registryError, setRegistryError] = useState<string | null>(null);
  const latestTokens = useRef([0, 0, 0, 0]);
  const panelStateRef = useRef(panels);
  const defaultSlotIds = useRef<string[]>([]);
  const pinnedSlotIds = useRef<string[]>([]);
  const defaultsApplied = useRef(false);
  const staleRefreshInProgress = useRef(false);
  const [pickLabel, setPickLabel] = useState<'random' | 'saved' | null>(null);
  const playlistCatalog = validateYoutubePlaylistCatalog(PLAYLIST_CATALOG) ? PLAYLIST_CATALOG : null;

  const updatePanel = (index: number, update: Partial<PanelState>) => {
    const next = panelStateRef.current.map((panel, panelIndex) =>
      panelIndex === index ? { ...panel, ...update } : panel,
    );
    panelStateRef.current = next;
    setPanels(next);
  };

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/youtube/channels')
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<unknown>;
      })
      .then((payload) => {
        if (cancelled) return;
        if (!validateYoutubeRegistry(payload)) throw new Error('The channel registry response was invalid.');
        const registry = payload as YoutubeChannelRegistry;
        pinnedSlotIds.current = registry.defaultSlots.slice(0, 4);
        const pinnedIds = new Set(pinnedSlotIds.current);
        const randomFill = pickRandomChannels<YoutubeChannel>(
          registry.channels.filter((channel) => !pinnedIds.has(channel.id)),
          Math.max(0, 4 - pinnedSlotIds.current.length),
        ).map((channel) => channel.id);
        const savedPicks = loadPanelPicks(new Set(registry.channels.map((channel) => channel.id)));
        if (savedPicks) {
          defaultSlotIds.current = savedPicks;
          setPickLabel('saved');
        } else {
          defaultSlotIds.current = [...pinnedSlotIds.current, ...randomFill];
          setPickLabel(randomFill.length > 0 ? 'random' : null);
        }
        const savedShows: Record<string, YoutubePlaylist[]> = {};
        for (const channel of registry.channels) {
          if (!channel.main || !playlistCatalog) continue;
          const seed = playlistCatalog.channels.find((entry) => (
            entry.registryId === channel.id && entry.channelId === channel.channelId
          ));
          if (seed) savedShows[channel.id] = loadAddedShows(channel.id, seed.playlists);
        }
        setChannels(registry.channels);
        setAddedShowsByChannel(savedShows);
        const initialPanels = EMPTY_PANELS.map((panel, index) => ({
          ...panel,
          selectedChannelId: defaultSlotIds.current[index] ?? '',
          busy: Boolean(defaultSlotIds.current[index]),
        }));
        panelStateRef.current = initialPanels;
        setPanels(initialPanels);
        setRegistryStatus('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setRegistryError(error instanceof Error ? error.message : 'Could not load the YouTube channel list.');
        setRegistryStatus('error');
      });
    return () => {
      cancelled = true;
      latestTokens.current = latestTokens.current.map((token) => token + 1);
    };
  }, []);

  const chooseChannel = async (
    index: number,
    channelId: string,
    options: ChannelLookupOptions = {},
  ) => {
    const channel = channels.find((entry) => entry.id === channelId);
    if (!channel) {
      updatePanel(index, {
        selectedChannelId: '',
        video: null,
        latestVideo: null,
        error: null,
        playing: false,
        openVideoId: null,
        activeTab: 'latest',
        liveUnavailable: false,
      });
      return;
    }

    const reportLookupFailure = (
      reason: YoutubeFailure,
      explicitMessage?: string,
      useLastGoodMessage = true,
    ) => {
      const currentVideo = panelStateRef.current[index].latestVideo;
      const lastGood = currentVideo?.channelLookupId === channel.id ? currentVideo : null;
      updatePanel(index, {
        video: lastGood,
        latestVideo: lastGood,
        busy: false,
        error: lastGood && useLastGoodMessage
          ? lastGoodFailureMessage(lastGood.asOf)
          : explicitMessage ?? failureMessage(reason),
        playing: false,
        activeTab: 'latest',
        liveUnavailable: false,
        openVideoId: null,
      });
    };
    const canApplyStaleRefresh = () => {
      if (!options.staleRefresh) return true;
      const currentPanel = panelStateRef.current[index];
      return currentPanel.selectedChannelId === channel.id
        && currentPanel.video !== null
        && currentPanel.activeTab === 'latest'
        && currentPanel.video.kind === 'video'
        && currentPanel.video.videoId === options.expectedVideoId
        && currentPanel.video.channelLookupId === channel.id
        && !currentPanel.playing
        && !document.getElementById(`youtube-frame-${index}`);
    };

    const token = ++latestTokens.current[index];
    const existingLatest = panelStateRef.current[index].latestVideo;
    const sameChannelLastGood = existingLatest?.channelLookupId === channel.id ? existingLatest : null;
    updatePanel(index, {
      selectedChannelId: channelId,
      video: sameChannelLastGood,
      latestVideo: sameChannelLastGood,
      busy: true,
      error: null,
      playing: false,
      openVideoId: null,
      activeTab: 'latest',
      liveUnavailable: false,
    });
    try {
      const response = await fetch(`/api/youtube/channel-latest?channel=${encodeURIComponent(channel.id)}`);
      if (!response.ok) throw new Error(`Channel lookup failed (HTTP ${response.status}).`);
      const payload: unknown = await response.json();
      if (token !== latestTokens.current[index]) return;
      if (!validateYoutubeLatestResponse(payload)) {
        reportLookupFailure('bad-response');
        return;
      }
      const result = payload as YoutubeLatestResponse;
      if (!result.ok) {
        reportLookupFailure(result.reason);
        return;
      }
      if (!isYoutubeVideoId(result.video.videoId)) {
        reportLookupFailure('bad-response', 'The channel returned an invalid video ID.', false);
        return;
      }
      if (!canApplyStaleRefresh()) {
        updatePanel(index, { busy: false });
        return;
      }
      const nextVideo: WallVideo = {
        kind: 'video',
        videoId: result.video.videoId,
        title: result.video.title,
        channelName: result.channel.name,
        publishedAt: result.video.publishedAt,
        thumbnailUrl: isAllowedYoutubeUrl(result.thumbnailUrl) ? result.thumbnailUrl : null,
        asOf: result.asOf,
        staleReason: result.stale ? result.reason ?? 'snapshot is out of date' : null,
        channelLookupId: channel.id,
      };
      const otherIds = panelStateRef.current.flatMap((panel, panelIndex) =>
        panelIndex !== index && panel.video?.kind === 'video' ? [panel.video.videoId] : [],
      );
      if (otherIds.includes(nextVideo.videoId)) {
        reportLookupFailure('bad-response', 'This video is already displayed in another panel. Choose a different channel or video.', false);
        return;
      }
      const candidate = panelStateRef.current.map((panel, panelIndex) =>
        panelIndex === index
          ? { videoId: nextVideo.videoId }
          : { videoId: panel.video?.kind === 'video' ? panel.video.videoId : null },
      );
      if (!validateYoutubePanels(candidate)) {
        reportLookupFailure('bad-response', 'This video would duplicate another panel.', false);
        return;
      }
      updatePanel(index, {
        video: nextVideo,
        latestVideo: nextVideo,
        activeTab: 'latest',
        liveUnavailable: false,
        playing: false,
        busy: false,
        error: result.stale ? lastGoodFailureMessage(result.asOf) : null,
        openVideoId: null,
      });
    } catch {
      if (token !== latestTokens.current[index]) return;
      reportLookupFailure('upstream-error');
    }
  };

  const chooseChannelManually = (index: number, channelId: string) => {
    const picks = panelStateRef.current.map((panel) => panel.selectedChannelId);
    picks[index] = channelId;
    savePanelPicks(picks);
    setPickLabel('saved');
    void chooseChannel(index, channelId);
  };

  const selectShow = (index: number, show: YoutubePlaylist) => {
    const panel = panelStateRef.current[index];
    const channel = channels.find((entry) => entry.id === panel.selectedChannelId);
    if (!channel?.main || !isYoutubePlaylist(show)) return;
    updatePanel(index, selectYoutubeShowState(panel, channel, show));
  };

  const showLatest = (index: number) => {
    const panel = panelStateRef.current[index];
    if (panel.latestVideo) {
      updatePanel(index, {
        video: panel.latestVideo,
        activeTab: 'latest',
        playing: true,
        busy: false,
        error: null,
        openVideoId: null,
        liveUnavailable: false,
      });
      return;
    }
    if (panel.selectedChannelId) void chooseChannel(index, panel.selectedChannelId);
  };

  const showLive = (index: number, channel: YoutubeChannel) => {
    const live = playlistCatalog?.channels.find((entry) => (
      entry.registryId === channel.id && entry.channelId === channel.channelId
    ))?.live;
    if (!channel.main || !live || !isYoutubeVideoId(live.embedId)) {
      updatePanel(index, { error: 'The unverified live source is not available.' });
      return;
    }
    updatePanel(index, {
      selectedChannelId: channel.id,
      video: {
        kind: 'live',
        videoId: live.embedId,
        title: 'Live (unverified)',
        channelName: channel.name,
        publishedAt: null,
        thumbnailUrl: null,
        asOf: null,
        staleReason: null,
        channelLookupId: null,
      },
      activeTab: 'live',
      playing: true,
      busy: false,
      error: null,
      openVideoId: null,
      liveUnavailable: false,
    });
  };

  const addShow = async (index: number, rawValue: string) => {
    const panel = panelStateRef.current[index];
    const channel = channels.find((entry) => entry.id === panel.selectedChannelId);
    const catalog = channel && playlistCatalog?.channels.find((entry) => (
      entry.registryId === channel.id && entry.channelId === channel.channelId
    ));
    const playlistId = parseYoutubePlaylistId(rawValue.trim());
    if (!channel?.main || !catalog || !playlistId) {
      updatePanel(index, { error: `${RESOLVE_FAILURE_TEXT['invalid-input']} Paste a supported YouTube playlist link.` });
      return;
    }
    const existingShows = addedShowsByChannel[channel.id] ?? [];
    if (catalog.playlists.some((show) => show.id === playlistId)
      || existingShows.some((show) => show.id === playlistId)) {
      updatePanel(index, { error: 'That show is already in the catalog.' });
      return;
    }

    const token = ++latestTokens.current[index];
    updatePanel(index, {
      selectedChannelId: channel.id,
      activeTab: 'shows',
      busy: true,
      playing: false,
      error: null,
      openVideoId: null,
      liveUnavailable: false,
    });
    try {
      const response = await fetch('/api/youtube/playlist-resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: rawValue.trim() }),
      });
      if (!response.ok) throw new Error('upstream-error');
      const payload: unknown = await response.json();
      if (token !== latestTokens.current[index]) return;
      if (!validateYoutubePlaylistResolveResponse(payload)) {
        updatePanel(index, { busy: false, error: failureMessage('bad-response') });
        return;
      }
      const result = payload as YoutubePlaylistResolveResponse;
      if (result.ok === false) {
        updatePanel(index, { busy: false, error: failureMessage(result.reason) });
        return;
      }
      if (result.playlist.id !== playlistId) {
        updatePanel(index, { busy: false, error: failureMessage('bad-response') });
        return;
      }
      if (!saveAddedShow(channel.id, result.playlist, catalog.playlists)) {
        updatePanel(index, {
          busy: false,
          error: 'Could not save this show in browser storage. Check available storage and try again.',
        });
        return;
      }
      setAddedShowsByChannel((current) => ({
        ...current,
        [channel.id]: [...(current[channel.id] ?? []), result.playlist],
      }));
      selectShow(index, result.playlist);
    } catch {
      if (token !== latestTokens.current[index]) return;
      updatePanel(index, { busy: false, error: failureMessage('upstream-error') });
    }
  };

  const submitVideo = async (index: number, rawValue: string) => {
    const value = rawValue.trim();
    const directId = isYoutubeVideoId(value);
    const parsed = parseNewsInput(value, [youtubeProvider]);
    if (!parsed
      || parsed.provider !== 'youtube'
      || (!directId && !parsed.pageUrl)
      || (parsed.kind === 'id' && !isYoutubeVideoId(parsed.id))
      || (parsed.pageUrl !== undefined && parsed.id !== '' && !isYoutubeVideoId(parsed.id))) {
      updatePanel(index, {
        error: `${RESOLVE_FAILURE_TEXT['invalid-input']} Paste a supported YouTube video URL or 11-character video ID.`,
        openVideoId: null,
      });
      return;
    }

    const token = ++latestTokens.current[index];
    updatePanel(index, { busy: true, error: null, openVideoId: parsed.id });
    const result = await resolveNewsOnServer(parsed.pageUrl ?? value);
    if (token !== latestTokens.current[index]) return;
    if (result.ok === false) {
      updatePanel(index, { busy: false, error: failureMessage(result.reason) });
      return;
    }
    const media: ResolvedMedia = result.media;
    if (media.provider !== 'youtube' || !isYoutubeVideoId(media.embedId)) {
      updatePanel(index, { busy: false, error: RESOLVE_FAILURE_TEXT['bad-response'] });
      return;
    }
    const duplicate = panelStateRef.current.some((panel, panelIndex) =>
      panelIndex !== index && panel.video?.kind === 'video' && panel.video.videoId === media.embedId,
    );
    if (duplicate) {
      updatePanel(index, { busy: false, error: 'This video is already displayed in another panel.' });
      return;
    }
    const video: WallVideo = {
      kind: 'video',
      videoId: media.embedId,
      title: media.title,
      channelName: media.author ?? 'YouTube video',
      publishedAt: null,
      thumbnailUrl: media.thumbnailUrl && isAllowedYoutubeUrl(media.thumbnailUrl) ? media.thumbnailUrl : null,
      asOf: media.resolvedAt,
      staleReason: null,
      channelLookupId: null,
    };
    const candidate = panelStateRef.current.map((panel, panelIndex) =>
      panelIndex === index
        ? { videoId: video.videoId }
        : { videoId: panel.video?.kind === 'video' ? panel.video.videoId : null },
    );
    if (!validateYoutubePanels(candidate)) {
      updatePanel(index, { busy: false, error: 'This video would duplicate another panel.' });
      return;
    }
    updatePanel(index, {
      video,
      latestVideo: video,
      activeTab: 'latest',
      playing: true,
      busy: false,
      error: null,
      openVideoId: null,
      liveUnavailable: false,
    });
  };

  const shuffle = () => {
    const pinned = pinnedSlotIds.current.filter((id) => channels.some((channel) => channel.id === id));
    const pinnedSet = new Set(pinned);
    const random = pickRandomChannels<YoutubeChannel>(
      channels.filter((channel) => !pinnedSet.has(channel.id)),
      Math.max(0, 4 - pinned.length),
    ).map((channel) => channel.id);
    const picked = [...pinned, ...random].slice(0, 4);
    savePanelPicks(picked);
    setPickLabel('saved');
    picked.forEach((_, index) => {
      updatePanel(index, {
        video: null,
        latestVideo: null,
        activeTab: 'latest',
        playing: false,
        busy: false,
        openVideoId: null,
        error: null,
        liveUnavailable: false,
      });
    });
    // The server allows 3 simultaneous upstream lookups, so run the four panels one after another.
    void (async () => {
      for (let index = 0; index < picked.length; index++) {
        await chooseChannel(index, picked[index]);
      }
    })();
  };

  useEffect(() => {
    if (registryStatus !== 'ready' || defaultsApplied.current) return;
    defaultsApplied.current = true;
    let cancelled = false;
    // Sequential: the server allows 3 simultaneous upstream lookups, and four at once would fail the last panel.
    void (async () => {
      for (let index = 0; index < defaultSlotIds.current.length; index++) {
        if (cancelled) return;
        const channelId = defaultSlotIds.current[index];
        if (channels.some((channel) => channel.id === channelId)) {
          await chooseChannel(index, channelId);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [registryStatus, channels]);

  useEffect(() => {
    if (registryStatus !== 'ready') return;
    let cancelled = false;

    const refreshStalePanels = () => {
      if (cancelled || document.visibilityState !== 'visible' || staleRefreshInProgress.current) return;
      const now = Date.now();
      const candidates = panelStateRef.current.flatMap((panel, index) => {
        const video = panel.video;
        if (
          !video
          || video.kind !== 'video'
          || panel.activeTab !== 'latest'
          || panel.latestVideo?.videoId !== video.videoId
          || !video.channelLookupId
          || video.channelLookupId !== panel.selectedChannelId
          || !video.asOf
          || panel.busy
          || panel.playing
          || document.getElementById(`youtube-frame-${index}`)
        ) {
          return [];
        }
        const asOf = Date.parse(video.asOf);
        if (!Number.isFinite(asOf) || now - asOf <= STALE_REFRESH_AFTER_MS) return [];
        return [{ index, channelId: video.channelLookupId, videoId: video.videoId }];
      });
      if (candidates.length === 0) return;

      staleRefreshInProgress.current = true;
      void (async () => {
        try {
          for (const candidate of candidates) {
            if (cancelled) return;
            const panel = panelStateRef.current[candidate.index];
            const video = panel.video;
            const asOf = video?.asOf ? Date.parse(video.asOf) : Number.NaN;
            if (
              !video
              || video.kind !== 'video'
              || panel.activeTab !== 'latest'
              || panel.latestVideo?.videoId !== video.videoId
              || video.videoId !== candidate.videoId
              || video.channelLookupId !== candidate.channelId
              || panel.selectedChannelId !== candidate.channelId
              || panel.busy
              || panel.playing
              || document.getElementById(`youtube-frame-${candidate.index}`)
              || !Number.isFinite(asOf)
              || Date.now() - asOf <= STALE_REFRESH_AFTER_MS
            ) {
              continue;
            }
            await chooseChannel(candidate.index, candidate.channelId, {
              staleRefresh: true,
              expectedVideoId: candidate.videoId,
            });
          }
        } finally {
          staleRefreshInProgress.current = false;
        }
      })();
    };

    document.addEventListener('visibilitychange', refreshStalePanels);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', refreshStalePanels);
    };
  }, [registryStatus, channels]);

  return (
    <div className="w-full pb-24 md:pb-10" data-testid="youtube-news-wall">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-neutral-100">YouTube News Wall</h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-neutral-400">
            Curated channels, newest uploads. The wall does not detect live-stream status. Choose a channel or paste a YouTube video URL; players load only when their thumbnails are opened.
          </p>
          {registryStatus === 'loading' && (
            <p className="mt-2 text-xs text-neutral-500" role="status" data-testid="status-youtube-registry">Loading channel registry…</p>
          )}
          {registryStatus === 'error' && (
            <p className="mt-2 text-xs text-red-400" role="alert" data-testid="error-youtube-registry">
              {registryError ?? 'Could not load the YouTube channel list.'}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pickLabel && (
            <span
              className="font-mono text-[10px] uppercase tracking-wide text-neutral-400"
              data-testid={pickLabel === 'saved' ? 'label-youtube-your-picks' : 'label-youtube-random-picks'}
            >
              {pickLabel === 'saved' ? 'Your picks' : 'Random picks'}
            </span>
          )}
          <button
            type="button"
            onClick={shuffle}
            disabled={registryStatus !== 'ready' || channels.length === 0}
            className="rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="button-youtube-shuffle"
          >
            Shuffle
          </button>
          <span className="rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wide text-neutral-500" data-testid="status-youtube-playback">
            RSS uploads · no live detection
          </span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="grid-youtube-panels">
        {panels.map((panel, index) => {
          const channel = channels.find((entry) => entry.id === panel.selectedChannelId);
          const catalog = channel?.main && playlistCatalog
            ? playlistCatalog.channels.find((entry) => (
                entry.registryId === channel.id && entry.channelId === channel.channelId
              )) ?? null
            : null;
          return (
            <div key={index} className="min-w-0">
              <YoutubePanel
                index={index}
                channels={channels}
                catalog={catalog}
                addedShows={channel ? addedShowsByChannel[channel.id] ?? [] : []}
                panel={panel}
                onPanelChange={updatePanel}
                onChooseChannel={chooseChannelManually}
                onSubmitVideo={(panelIndex, value) => void submitVideo(panelIndex, value)}
                onSelectShow={selectShow}
                onAddShow={(panelIndex, value) => void addShow(panelIndex, value)}
                onShowLatest={showLatest}
                onShowLive={showLive}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default YoutubeWall;
