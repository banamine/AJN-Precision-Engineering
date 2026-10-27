import { useEffect, useMemo, useState } from 'react';
import type { NowPlayingMedia } from '../types';
import { BannedVideoWall } from '../components/BannedVideoWall';
import { DEMO_BANNED_VIDEO_SNAPSHOT } from './bannedvideo-fixture';
import { PlayerView } from '../components/PlayerView';
import { StatusIndicatorsView } from '../components/StatusIndicators';
import { describeArchiveStatus, describeNetworkStatus, describeNewsStatus, type ServiceIndicator } from '../utils/serviceStatus';
import { toPlayableSrc } from '../utils/playableSrc';
import type { ClientArchiveStatus } from '../hooks/useArchiveStatus';
import type { NewsReadySnapshot } from '../utils/newsReadyStore';
import type { DemoArchiveFixture, DemoFetchFixture, DemoNewsFixture, DemoWindow } from './demo-types';

type DemoScreen = 'status' | 'retry' | 'subtitles' | 'no-subtitles' | 'resume' | 'restricted' | 'nested-cyrillic' | 'non-media' | 'bannedvideo';

const PLAYER_SCREENS: DemoScreen[] = ['retry', 'subtitles', 'no-subtitles', 'resume', 'restricted', 'nested-cyrillic', 'non-media'];
const INITIAL_ARCHIVE: ClientArchiveStatus = { state: 'unknown', since: null, phase: 'checking' };
const INITIAL_NEWS: NewsReadySnapshot = { phase: 'checking', version: null, newShows: [], fetchedAt: null, refreshing: false, checkedAt: null };

function updateDemoFixture(fixture: Partial<DemoFetchFixture>): void {
  const target = window as DemoWindow;
  target.__AJN_DEMO_FIXTURE__ = {
    archive: target.__AJN_DEMO_FIXTURE__?.archive ?? 'checking',
    news: target.__AJN_DEMO_FIXTURE__?.news ?? 'checking',
    offline: target.__AJN_DEMO_FIXTURE__?.offline ?? false,
    player: target.__AJN_DEMO_FIXTURE__?.player ?? '',
    ...fixture,
  };
}

function DemoStatusPanel() {
  const [archiveFixture, setArchiveFixture] = useState<DemoArchiveFixture>('checking');
  const [newsFixture, setNewsFixture] = useState<DemoNewsFixture>('checking');
  const [offline, setOffline] = useState(false);
  const [archive, setArchive] = useState<ClientArchiveStatus>(INITIAL_ARCHIVE);
  const [news, setNews] = useState<NewsReadySnapshot>(INITIAL_NEWS);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setArchive(INITIAL_ARCHIVE);
    setNews(INITIAL_NEWS);
    updateDemoFixture({ archive: archiveFixture, news: newsFixture, offline, player: '' });
    void fetch('/api/archive/status', { signal: controller.signal, headers: { Accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Archive status ${response.status}`);
        return response.json() as Promise<{ state?: ClientArchiveStatus['state']; since?: number }>;
      })
      .then((data) => {
        if (!active) return;
        setArchive({
          state: data.state ?? 'unknown',
          since: Number.isFinite(data.since) ? Number(data.since) : null,
          phase: 'live',
        });
      })
      .catch(() => {
        if (active) setArchive({ state: 'unknown', since: null, phase: 'unavailable' });
      });
    void fetch('/api/news/version', { signal: controller.signal, headers: { Accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`News version ${response.status}`);
        return response.json() as Promise<{ version: number; fetchedAt: string | null; refreshing: boolean; newShows: NewsReadySnapshot['newShows'] }>;
      })
      .then((data) => {
        if (!active) return;
        setNews({
          phase: newsFixture === 'ready' && data.newShows.length > 0 ? 'ready' : 'current',
          version: data.version,
          newShows: data.newShows,
          fetchedAt: data.fetchedAt,
          refreshing: data.refreshing,
          checkedAt: Date.now(),
        });
      })
      .catch(() => {
        if (active) setNews({ ...INITIAL_NEWS, phase: 'error', checkedAt: Date.now() });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [archiveFixture, newsFixture, offline]);

  const indicators = useMemo(() => {
    const now = Date.now();
    const archiveIndicator = describeArchiveStatus({
      phase: archive.phase,
      state: archive.state,
      since: archive.since,
      now,
      progressAt: archiveFixture === 'playing' ? now : null,
    });
    const newsIndicator = describeNewsStatus(news);
    const networkIndicator = describeNetworkStatus(!offline);
    return [archiveIndicator, newsIndicator, ...(networkIndicator ? [networkIndicator] : [])] as ServiceIndicator[];
  }, [archive, archiveFixture, news, offline]);

  const archiveButtons: Array<[DemoArchiveFixture, string]> = [
    ['checking', 'Archive checking'],
    ['available', 'Archive available'],
    ['slow', 'Archive slow'],
    ['unavailable', 'Archive status unknown'],
    ['unknown', 'Archive not checked'],
    ['playing', 'Archive playing override'],
  ];
  const newsButtons: Array<[DemoNewsFixture, string]> = [
    ['checking', 'News checking'],
    ['current', 'News current'],
    ['updating', 'News updating'],
    ['delayed', 'News delayed'],
    ['ready', 'News ready (3)'],
  ];

  return (
    <section className="space-y-4" data-testid="demo-status-panel">
      <p className="text-sm text-neutral-300">DEMO — status responses come from local fixtures at /api/archive/status and /api/news/version.</p>
      <div className="grid gap-4 md:grid-cols-3">
        <fieldset className="rounded-lg border border-neutral-800 p-3">
          <legend className="px-2 text-xs font-semibold text-neutral-300">Archive states</legend>
          <div className="flex flex-wrap gap-2">
            {archiveButtons.map(([value, label]) => (
              <button key={value} type="button" onClick={() => setArchiveFixture(value)} aria-pressed={archiveFixture === value} className="rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300" data-testid={`demo-archive-${value}`}>
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="rounded-lg border border-neutral-800 p-3">
          <legend className="px-2 text-xs font-semibold text-neutral-300">News states</legend>
          <div className="flex flex-wrap gap-2">
            {newsButtons.map(([value, label]) => (
              <button key={value} type="button" onClick={() => setNewsFixture(value)} aria-pressed={newsFixture === value} className="rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300" data-testid={`demo-news-${value}`}>
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="rounded-lg border border-neutral-800 p-3">
          <legend className="px-2 text-xs font-semibold text-neutral-300">Connection state</legend>
          <button type="button" onClick={() => setOffline((value) => !value)} aria-pressed={offline} className="rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300" data-testid="demo-offline">
            {offline ? 'Show online' : 'Show offline'}
          </button>
        </fieldset>
      </div>
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/70 p-3">
        <StatusIndicatorsView indicators={indicators} newsSnapshot={news} onNewsSeen={() => setNews((current) => ({ ...current, phase: 'current', newShows: [] }))} />
      </div>
    </section>
  );
}

function playerMedia(screen: DemoScreen): NowPlayingMedia {
  const paths: Record<string, string> = {
    retry: '/download/demo-retry/synthetic.webm',
    subtitles: '/download/demo-subtitles/synthetic.webm',
    'no-subtitles': '/download/demo-no-subtitles/synthetic.webm',
    resume: '/download/demo-resume/synthetic.webm',
    restricted: '/download/demo-restricted/synthetic.webm',
    'nested-cyrillic': '/download/demo-nested/Демо/папка/Клип.webm',
    'non-media': '/download/demo-html/synthetic.webm',
  };
  const path = paths[screen] ?? paths.retry;
  const archiveReference = `https://archive.org${path}`;
  const src = toPlayableSrc(archiveReference);
  const item: NowPlayingMedia = {
    programId: `demo-${screen}`,
    sourceId: 'demo-fixture',
    src,
    archivePath: archiveReference,
    title: `DEMO — synthetic ${screen.replaceAll('-', ' ')} media`,
    channelName: 'DEMO fixture',
    channelId: 'demo-channel',
    guideId: 'demo-guide',
    mediaType: 'video',
    duration: '1:00',
  };
  return item;
}

function DemoPlayerFixture({ screen }: { screen: DemoScreen }) {
  const item = useMemo(() => playerMedia(screen), [screen]);
  useEffect(() => {
    updateDemoFixture({ archive: 'available', news: 'current', offline: false, player: screen });
  }, [screen]);

  return (
    <section className="space-y-4" data-testid={`demo-player-${screen}`}>
      <p className="text-sm text-neutral-300">DEMO — the media and proxy responses are local fixtures; no Archive request is sent.</p>
      <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 p-3">
        <PlayerView nowPlaying={item} onSelectProgram={() => {}} onProgress={() => {}} onNavigate={() => {}} isFavorite={false} onToggleFavorite={() => {}} />
      </div>
      {screen === 'nested-cyrillic' && (
        <p className="rounded border border-neutral-800 p-3 font-mono text-xs text-neutral-300" data-testid="demo-nested-path">
          DEMO path: {item.archivePath}
        </p>
      )}
    </section>
  );
}

export function DemoApp() {
  const [screen, setScreen] = useState<DemoScreen>('status');
  const [simulateEmbedBlocked, setSimulateEmbedBlocked] = useState(true);
  const screens: Array<[DemoScreen, string]> = [
    ['status', 'Status lights'],
    ['retry', 'Retry countdown'],
    ['subtitles', 'English subtitles'],
    ['no-subtitles', 'No English subtitles'],
    ['resume', 'Resume prompt'],
    ['restricted', 'Restricted item'],
    ['nested-cyrillic', 'Nested Cyrillic path'],
    ['non-media', 'HTML instead of media'],
    ['bannedvideo', 'BANNED VIDEO wall'],
  ];

  const selectScreen = (next: DemoScreen) => {
    if (next === 'resume') {
      try { localStorage.setItem(`ajn-playback-position:${playerMedia(next).programId}`, '42'); } catch {}
    }
    if (PLAYER_SCREENS.includes(next)) updateDemoFixture({ archive: 'available', news: 'current', offline: false, player: next });
    if (next === 'status') updateDemoFixture({ archive: 'checking', news: 'checking', offline: false, player: '' });
    if (next === 'bannedvideo') updateDemoFixture({ archive: 'available', news: 'current', offline: false, player: '' });
    localStorage.setItem('demo-fixture', next);
    setScreen(next);
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="fixed left-2 top-2 z-[100] rounded-md border border-amber-400 bg-amber-300 px-3 py-1.5 text-xs font-extrabold text-neutral-950 shadow-lg" data-testid="demo-banner">
        DEMO DATA — not live
      </div>
      <main className="mx-auto max-w-7xl space-y-5 px-3 pb-10 pt-16 sm:px-6">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-300">AJN offline review harness</p>
          <h1 className="text-2xl font-bold">Playback, status and BANNED VIDEO fixtures</h1>
        <p className="max-w-3xl text-sm leading-6 text-neutral-300">Every demo state is synthetic, including the BANNED VIDEO titles and channels. No real thumbnail, page text, caption, or embedded player is used.</p>
        </header>
        <nav aria-label="Demo scenarios" className="flex flex-wrap gap-2" role="tablist">
          {screens.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={screen === id} onClick={() => selectScreen(id)} className={`rounded-lg border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${screen === id ? 'border-amber-300 bg-amber-300 text-neutral-950' : 'border-neutral-700 bg-neutral-900 text-neutral-200 hover:bg-neutral-800'}`} data-testid={`demo-fixture-${id}`}>
              {label}
            </button>
          ))}
        </nav>
        {screen === 'status' && <DemoStatusPanel />}
        {PLAYER_SCREENS.includes(screen) && <DemoPlayerFixture key={screen} screen={screen} />}
        {screen === 'bannedvideo' && (
          <section className="space-y-4" data-testid="demo-bannedvideo">
            <label className="flex w-fit items-center gap-2 rounded border border-neutral-800 px-3 py-2 text-sm">
              <input type="checkbox" checked={simulateEmbedBlocked} onChange={(event) => setSimulateEmbedBlocked(event.target.checked)} data-testid="demo-simulate-embed-blocked" />
              Simulate embed blocked
            </label>
            <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
          <BannedVideoWall offlineDemo simulateEmbedBlocked={simulateEmbedBlocked} demoSnapshot={DEMO_BANNED_VIDEO_SNAPSHOT} />
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
