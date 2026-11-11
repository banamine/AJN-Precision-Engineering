/* App Health Neural Twin: the map of the app (Entry 050). Pure data and layout, no telemetry here.
 * The map is the ARCHITECTURE (which part feeds which). Whether a part is alive comes only from telemetry.ts. */
export type LobeId = 'audio' | 'video' | 'search' | 'news' | 'server' | 'sync' | 'ui';
export interface Lobe { id: LobeId; label: string; color: string }
export type ProbeKind = 'audio-element' | 'video-element' | 'jingle' | 'shared-query' | 'count-concerts' | 'count-fm' | 'count-rss' | 'count-podcasts' | 'digest' | 'video-frame' | 'unwired';
export interface Neuron { id: string; lobe: LobeId; label: string; file: string; role: string; probe: ProbeKind; emptyNote?: string }
export interface Edge { from: string; to: string; kind: string }

export const LOBES: Lobe[] = [
  { id: 'audio', label: 'Audio & 1-DIN dock', color: '#22d3ee' },
  { id: 'video', label: 'Video, EPG & buffer jingle', color: '#818cf8' },
  { id: 'search', label: 'Ingestion, registry & search', color: '#fbbf24' },
  { id: 'news', label: 'Daily digest, News Cube & ticker', color: '#34d399' },
  { id: 'server', label: 'SafeFetch & status', color: '#c084fc' },
  { id: 'sync', label: 'GitHub sync & manifest ingest', color: '#f472b6' },
  { id: 'ui', label: 'UI keys & visual trackers', color: '#fb923c' },
];

const UNWIRED = 'No live signal is wired for this part yet.';
export const NEURONS: Neuron[] = [
  { id: 'minimal-player', lobe: 'audio', label: 'MinimalPlayer', file: 'src/MinimalPlayer.tsx', role: 'The audio engine (protected core).', probe: 'audio-element' },
  { id: 'radio-presets', lobe: 'audio', label: 'Radio presets 01-05', file: 'src/components/RadioPresetsBar.tsx', role: 'Cockpit rocker preset keys.', probe: 'unwired', emptyNote: UNWIRED },
  { id: 'mini-player-dock', lobe: 'audio', label: 'MiniPlayerDock', file: 'src/components/MiniPlayerDock.tsx', role: 'The persistent 1-DIN dock.', probe: 'unwired', emptyNote: UNWIRED },
  { id: 'radio-spectrum', lobe: 'audio', label: 'RadioSpectrum', file: 'src/components/RadioSpectrum.tsx', role: 'Spectrum analyser (real AnalyserNode only).', probe: 'unwired', emptyNote: 'The analyser state is not exposed outside the component.' },
  { id: 'schedule-deck', lobe: 'audio', label: 'Schedule deck', file: 'src/components/ScheduleDeck.tsx', role: '24-hour round-robin schedule deck.', probe: 'unwired', emptyNote: UNWIRED },

  { id: 'player-view', lobe: 'video', label: 'Player video', file: 'src/components/PlayerView.tsx', role: 'Full-screen video player.', probe: 'video-element' },
  { id: 'buffer-jingle', lobe: 'video', label: 'Buffer jingle', file: 'src/components/BufferJingle.tsx', role: '"The Quiet Between" waiting-room interstitial.', probe: 'jingle' },
  { id: 'av-sync', lobe: 'video', label: 'AV sync', file: 'src/hooks/useAvSync.ts', role: 'Pairs radio audio with video.', probe: 'unwired', emptyNote: UNWIRED },
  { id: 'tv-guide', lobe: 'video', label: 'TV guide', file: 'src/components/TvGuideView.tsx', role: 'EPG (protected core).', probe: 'unwired', emptyNote: UNWIRED },
  { id: 'rumble-wall', lobe: 'video', label: 'Rumble wall', file: 'src/components/RumbleNewsWall.tsx', role: 'Video-only news wall.', probe: 'unwired', emptyNote: UNWIRED },

  { id: 'registry-csv', lobe: 'search', label: 'Media registry CSV', file: 'tools/metadata/media_master_registry.csv', role: 'Offline search-metadata registry built by tools/generate_media_registry.py. Not loaded at runtime.', probe: 'unwired', emptyNote: 'Generated offline; the app does not read it at runtime.' },
  { id: 'actor-director-graph', lobe: 'search', label: 'Actor / director graph', file: 'src/utils/actorDirectorGraph.ts (not built)', role: 'Would link movies by cast and director.', probe: 'unwired', emptyNote: 'No cast or director metadata source exists yet, so this neuron stays empty rather than showing invented names.' },
  { id: 'library-index', lobe: 'search', label: 'Library index', file: 'server/libraryIndex.ts', role: 'The single searchable Library index.', probe: 'unwired', emptyNote: 'Server-side; no stats endpoint is read here.' },
  { id: 'shared-search', lobe: 'search', label: 'Shared search query', file: 'src/hooks/useSharedSearch.ts', role: 'One query shared by the Library and TV/News search.', probe: 'shared-query' },
  { id: 'concert-manifest', lobe: 'search', label: 'Concert manifest', file: 'src/data/concertPoolsManifest.json', role: 'Live concert pools.', probe: 'count-concerts' },
  { id: 'fm-manifest', lobe: 'search', label: 'FM broadcast manifest', file: 'src/data/fmBroadcastChannels.json', role: 'FM broadcast recordings.', probe: 'count-fm' },

  { id: 'daily-digest-json', lobe: 'news', label: 'Daily digest data.json', file: 'banamine.github.io/Daily-News-Digest-/data/current/data.json', role: 'The hourly digest the app reads.', probe: 'digest' },
  { id: 'news-cube', lobe: 'news', label: 'News Cube', file: 'src/news-cube/NewsCubePage.tsx', role: '36 headlines on a 6-face cube.', probe: 'unwired', emptyNote: UNWIRED },
  { id: 'daily-briefing', lobe: 'news', label: 'Daily briefing ticker', file: 'src/components/DailyBriefing.tsx', role: 'Headline ticker and briefing.', probe: 'unwired', emptyNote: UNWIRED },
  { id: 'news-rss-sources', lobe: 'news', label: 'RSS feed list', file: 'src/data/newsRssSources.json', role: 'The digest repo feed list.', probe: 'count-rss' },

  { id: 'safe-fetch', lobe: 'server', label: 'SafeFetch', file: 'server/safeFetch.ts', role: 'SSRF guard for server fetches.', probe: 'unwired', emptyNote: 'Server-side; no stats endpoint is read here.' },
  { id: 'radio-now-playing', lobe: 'server', label: 'ICY now-playing', file: 'server/radioNowPlaying.ts', role: 'Reads station metadata, max 4 readers.', probe: 'unwired', emptyNote: 'The server does not expose its reader count.' },
  { id: 'podcast-sources', lobe: 'server', label: 'Podcast sources', file: 'src/data/podcastSources.json', role: 'Podcast feed list.', probe: 'count-podcasts' },
  { id: 'status-external-fetch', lobe: 'server', label: 'External fetch status', file: '(measured here)', role: 'Round-trip time of the last digest check you ran.', probe: 'digest' },
  { id: 'status-cache-payload', lobe: 'server', label: 'Cache payload status', file: '(no endpoint)', role: 'Cache size and TTLs.', probe: 'unwired', emptyNote: 'The server has no cache-stats endpoint, so nothing is shown.' },

  { id: 'github-repo-sync', lobe: 'sync', label: 'Repo / commit', file: 'banamine/AJN-Precision-Engineering', role: 'Which commit is running.', probe: 'unwired', emptyNote: 'The build does not embed a commit SHA (audit Step 0).' },
  { id: 'github-digest-collector', lobe: 'sync', label: 'Digest collector', file: 'banamine/Daily-News-Digest- (daily_news.py)', role: 'Hourly cron that writes data.json.', probe: 'digest' },
  { id: 'manifest-ingest', lobe: 'sync', label: 'Manifest ingest tools', file: 'tools/generate_media_registry.py, tools/build-concert-library.py', role: 'Offline scripts that build the manifests.', probe: 'unwired', emptyNote: 'Offline scripts; they report nothing to the app.' },

  { id: 'ui-rocker', lobe: 'ui', label: 'Rocker keys', file: 'src/cockpit.css', role: 'Cockpit key styling and latch state.', probe: 'unwired', emptyNote: UNWIRED },
  { id: 'ui-ghost-input', lobe: 'ui', label: 'Ghost search input', file: 'src/components/LibraryView.tsx', role: 'Per-letter search with ghost completion.', probe: 'shared-query' },
  { id: 'tracker-tv', lobe: 'ui', label: 'TV frame tracker', file: 'src/neural/telemetry.ts', role: 'A frame of the video you are watching, every 30 s, only while video plays.', probe: 'video-frame' },
  { id: 'tracker-podcast', lobe: 'ui', label: 'Podcast cover tracker', file: '(not built)', role: 'Cover art of the playing podcast.', probe: 'unwired', emptyNote: 'No cover-art source is wired.' },
];

export const EDGES: Edge[] = [
  { from: 'radio-presets', to: 'minimal-player', kind: 'tune' }, { from: 'minimal-player', to: 'mini-player-dock', kind: 'state' },
  { from: 'minimal-player', to: 'radio-spectrum', kind: 'audio' }, { from: 'schedule-deck', to: 'minimal-player', kind: 'queue' },
  { from: 'minimal-player', to: 'av-sync', kind: 'clock' }, { from: 'av-sync', to: 'player-view', kind: 'sync' },
  { from: 'tv-guide', to: 'player-view', kind: 'play' }, { from: 'rumble-wall', to: 'player-view', kind: 'play' },
  { from: 'player-view', to: 'buffer-jingle', kind: 'waiting' }, { from: 'buffer-jingle', to: 'minimal-player', kind: 'duck' },
  { from: 'concert-manifest', to: 'library-index', kind: 'records' }, { from: 'fm-manifest', to: 'library-index', kind: 'records' },
  { from: 'registry-csv', to: 'library-index', kind: 'synonyms' }, { from: 'shared-search', to: 'library-index', kind: 'query' },
  { from: 'ui-ghost-input', to: 'shared-search', kind: 'keystrokes' }, { from: 'actor-director-graph', to: 'library-index', kind: 'cast' },
  { from: 'library-index', to: 'radio-presets', kind: 'results' }, { from: 'library-index', to: 'tv-guide', kind: 'results' },
  { from: 'news-rss-sources', to: 'github-digest-collector', kind: 'feeds' }, { from: 'github-digest-collector', to: 'daily-digest-json', kind: 'publish' },
  { from: 'daily-digest-json', to: 'news-cube', kind: 'headlines' }, { from: 'daily-digest-json', to: 'daily-briefing', kind: 'headlines' },
  { from: 'daily-briefing', to: 'schedule-deck', kind: 'ticker' }, { from: 'status-external-fetch', to: 'daily-digest-json', kind: 'rtt' },
  { from: 'safe-fetch', to: 'radio-now-playing', kind: 'guard' }, { from: 'radio-now-playing', to: 'minimal-player', kind: 'now playing' },
  { from: 'podcast-sources', to: 'minimal-player', kind: 'episodes' }, { from: 'status-cache-payload', to: 'safe-fetch', kind: 'cache' },
  { from: 'manifest-ingest', to: 'concert-manifest', kind: 'build' }, { from: 'manifest-ingest', to: 'fm-manifest', kind: 'build' },
  { from: 'manifest-ingest', to: 'registry-csv', kind: 'build' }, { from: 'github-repo-sync', to: 'manifest-ingest', kind: 'commit' },
  { from: 'ui-rocker', to: 'radio-presets', kind: 'presses' }, { from: 'player-view', to: 'tracker-tv', kind: 'frames' },
  { from: 'tracker-podcast', to: 'radio-presets', kind: 'cover' },
];

/** Deterministic 3D layout: lobes on a ring, each lobe's neurons on a small circle around its centre. */
export function layout(): Record<string, [number, number, number]> {
  const out: Record<string, [number, number, number]> = {};
  LOBES.forEach((lobe, li) => {
    const a = (li / LOBES.length) * Math.PI * 2;
    const c: [number, number, number] = [Math.cos(a) * 7, (li % 2 ? 1.6 : -1.6), Math.sin(a) * 7];
    const members = NEURONS.filter((n) => n.lobe === lobe.id);
    members.forEach((n, i) => {
      const b = (i / members.length) * Math.PI * 2;
      out[n.id] = [c[0] + Math.cos(b) * 1.7, c[1] + Math.sin(b * 2) * 0.9, c[2] + Math.sin(b) * 1.7];
    });
  });
  return out;
}
