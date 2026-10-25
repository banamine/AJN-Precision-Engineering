import { useEffect, useMemo, useState } from 'react';
import { Archive, ExternalLink, ListOrdered, Play, Repeat, RotateCcw, Shuffle, SkipForward } from 'lucide-react';
import { BANNED_VIDEO_SNAPSHOT } from '../bannedvideo/registry';
import { buildPool, emptyWallState, fillWall, nextInPanel, stateFitsPool, unassignedCount, type Pool, type Rng } from '../bannedvideo/allocate';
import { formatAirDate, parseAirDate } from '../bannedvideo/airDate';
import { embedUrlFor, validateBannedVideoSnapshot } from '../bannedvideo/validate';
import { browserWallStorage, clearSavedWall, loadSavedWall, saveWall, type WallStorage } from '../bannedvideo/storage';
import type { BannedVideoItem, BannedVideoSnapshot, PanelIndex, WallFilter, WallState } from '../bannedvideo/types';
import { PANEL_INDICES } from '../bannedvideo/types';

/** Ordering randomness only (shuffle bag, in-year vault order). Never used for status or metrics. */
const defaultRng: Rng = () => Math.random();

const BANNER_SRC = '/images/bannedvideo-banner.webp';

const PANEL_META: Record<PanelIndex, { chip: string; name: string; rule: string; Icon: typeof ListOrdered; next: string }> = {
  0: { chip: 'BV1', name: 'Trending', rule: 'Trending order, first to last', Icon: ListOrdered, next: 'Next' },
  1: { chip: 'BV2', name: 'Shuffle', rule: 'Random, no repeats until all have played', Icon: Shuffle, next: 'Next' },
  2: { chip: 'BV3', name: 'Vault', rule: 'Oldest air year first', Icon: Archive, next: 'Next' },
  3: { chip: 'BV4', name: 'Rotation', rule: 'Everything else, fewest queued first', Icon: Repeat, next: 'Next' },
};

function formatDuration(totalSec: number): string {
  const s = Math.round(totalSec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

function formatScrapedAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function pagesLabel(pages: number[]): string {
  if (pages.length === 0) return 'pages';
  const min = Math.min(...pages);
  const max = Math.max(...pages);
  return min === max ? `page ${min}` : `pages ${min}–${max}`;
}

function panelDetail(panel: PanelIndex, item: BannedVideoItem, state: WallState, total: number): string {
  switch (panel) {
    case 0: return `Trending #${item.rank} of ${total}`;
    case 1: return `${state.shuffleBag.length} left this round`;
    case 2: {
      const date = parseAirDate(item.title);
      return date ? `Aired ${formatAirDate(date)} (from title)` : 'Air date unknown';
    }
    case 3: return `Queued ${state.queuedCounts[item.id] ?? 0}×`;
  }
}

function emptyPanelText(panel: PanelIndex, pool: Pool): string {
  if (pool.items.length === 0) return 'No videos in this view.';
  if (panel === 2 && pool.vault.length === 0) return 'No videos with an air date in their title in this view.';
  return 'No unique video left for this panel in this view (a video is never shown on two panels at once).';
}

interface PanelProps {
  panel: PanelIndex;
  item: BannedVideoItem | null;
  pool: Pool;
  state: WallState;
  total: number;
  loaded: boolean;
  note: string | null;
  offlineDemo: boolean;
  simulateEmbedBlocked: boolean;
  onLoad: () => void;
  onNext: () => void;
}

function BannedVideoPanel({ panel, item, pool, state, total, loaded, note, offlineDemo, simulateEmbedBlocked, onLoad, onNext }: PanelProps) {
  const meta = PANEL_META[panel];
  const Icon = meta.Icon;
  return (
    <section className="flex min-w-0 flex-col rounded-lg border border-neutral-800 bg-neutral-950/60 p-3" data-testid={`bannedvideo-panel-${panel + 1}`} aria-label={`${meta.chip} ${meta.name}`}>
      <header className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="rounded border border-neutral-700 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-neutral-300">{meta.chip}</span>
          <h2 className="truncate text-sm font-semibold text-neutral-100">{meta.name}</h2>
        </div>
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-neutral-400">
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          {meta.rule}
        </span>
      </header>

      <div className="relative aspect-video w-full overflow-hidden rounded-md border border-neutral-800 bg-neutral-900">
        {!item && (
          <p className="flex h-full items-center justify-center p-4 text-center text-xs text-neutral-400" role="status" data-testid={`bannedvideo-empty-${panel + 1}`}>
            {emptyPanelText(panel, pool)}
          </p>
        )}
        {item && loaded && offlineDemo && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-neutral-950 p-4 text-center text-sm text-amber-200"
            role="alert"
            data-testid={`bannedvideo-demo-embed-state-${panel + 1}`}
          >
            {simulateEmbedBlocked ? "DEMO — embed blocked (simulated)." : "DEMO — external players are disabled in this offline preview."}
          </div>
        )}
        {item && loaded && !offlineDemo && (
          <iframe
            key={item.id}
            src={embedUrlFor(item.id)}
            title={item.title}
            className="absolute inset-0 h-full w-full border-0"
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            data-testid={`bannedvideo-embed-${panel + 1}`}
          />
        )}
        {item && !loaded && (
          <button
            type="button"
            onClick={onLoad}
            className="group absolute inset-0 h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            aria-label={`Load player: ${item.title}`}
            data-testid={`bannedvideo-load-${panel + 1}`}
          >
            {offlineDemo ? (
              <span className="flex h-full w-full items-center justify-center bg-neutral-800 text-xs font-semibold tracking-widest text-neutral-300">DEMO — synthetic item</span>
            ) : (
              <img src={item.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover opacity-80 transition-opacity group-hover:opacity-100" />
            )}
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex items-center gap-1.5 rounded-full bg-neutral-950/80 px-3 py-1.5 text-xs font-medium text-neutral-100">
                <Play className="h-3.5 w-3.5" aria-hidden="true" /> Load player
              </span>
            </span>
          </button>
        )}
      </div>

      {item && (
        <div className="mt-2 min-w-0">
          <p className="line-clamp-2 text-sm font-medium text-neutral-100" title={item.title}>{item.title}</p>
          <p className="mt-0.5 text-[11px] text-neutral-400">
            {item.channel} · {offlineDemo ? 'DEMO duration ' : ''}{formatDuration(item.durationSec)}{item.maxHeight ? ` · up to ${item.maxHeight}p` : ''}
          </p>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-neutral-500" data-testid={`bannedvideo-detail-${panel + 1}`}>
            {panelDetail(panel, item, state, total)}
          </p>
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-2">
        {item && offlineDemo ? (
          <span className="text-[11px] text-neutral-500">External link disabled in demo</span>
        ) : item ? (
          <a href={item.watchUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-neutral-200">
            <ExternalLink className="h-3 w-3" aria-hidden="true" /> Open on banned.video
          </a>
        ) : <span />}
        <button
          type="button"
          onClick={onNext}
          disabled={pool.items.length === 0}
          className="flex items-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid={`bannedvideo-next-${panel + 1}`}
        >
          <SkipForward className="h-3.5 w-3.5" aria-hidden="true" /> {meta.next}
        </button>
      </div>
      {note && <p className="mt-1 text-[11px] text-amber-300" role="status">{note}</p>}
    </section>
  );
}

interface WallBodyProps {
  snapshot: BannedVideoSnapshot;
  storage: WallStorage | null;
  rng: Rng;
  offlineDemo: boolean;
  simulateEmbedBlocked: boolean;
}

function WallBody({ snapshot, storage, rng, offlineDemo, simulateEmbedBlocked }: WallBodyProps) {
  const [initial] = useState(() => {
    const saved = loadSavedWall(storage);
    let filter: WallFilter = saved?.filter ?? { network: 'ajn', channel: 'all' };
    let pool = buildPool(snapshot, filter);
    if (filter.channel !== 'all' && !pool.channelOptions.some((c) => c.name === filter.channel)) {
      filter = { ...filter, channel: 'all' };
      pool = buildPool(snapshot, filter);
    }
    const state = saved && stateFitsPool(saved.state, pool) && saved.state.panels.some((id) => id !== null)
      ? saved.state
      : fillWall(pool, rng, saved?.state);
    return { filter, state };
  });
  const [filter, setFilter] = useState<WallFilter>(initial.filter);
  const [state, setState] = useState<WallState>(initial.state);
  const [loaded, setLoaded] = useState<boolean[]>([false, false, false, false]);
  const [notes, setNotes] = useState<(string | null)[]>([null, null, null, null]);
  const [storageOk, setStorageOk] = useState(true);

  const pool = useMemo(() => buildPool(snapshot, filter), [snapshot, filter]);
  const channelOptions = useMemo(() => buildPool(snapshot, { network: filter.network, channel: 'all' }).channelOptions, [snapshot, filter.network]);

  useEffect(() => {
    setStorageOk(saveWall(storage, { version: 1, filter, state }));
  }, [storage, filter, state]);

  const applyFilter = (next: WallFilter) => {
    const nextPool = buildPool(snapshot, next);
    setFilter(next);
    setState((current) => fillWall(nextPool, rng, current));
    setLoaded([false, false, false, false]);
    setNotes([null, null, null, null]);
  };

  const next = (panel: PanelIndex) => {
    const result = nextInPanel(state, pool, panel, rng);
    setState(result.state);
    setNotes((current) => current.map((n, i) => (i === panel ? (result.changed ? null : 'No other video is free for this panel right now.') : n)));
  };

  const reset = () => {
    clearSavedWall(storage);
    const fresh = fillWall(pool, rng, emptyWallState());
    setState(fresh);
    setLoaded([false, false, false, false]);
    setNotes([null, null, null, null]);
  };

  const total = snapshot.items.length;
  const unassigned = unassignedCount(state, pool);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-neutral-800 bg-neutral-950 p-1" role="group" aria-label="Network">
          {(['ajn', 'rav'] as const).map((network) => (
            <button
              key={network}
              type="button"
              aria-pressed={filter.network === network}
              onClick={() => filter.network !== network && applyFilter({ network, channel: 'all' })}
              className={`rounded-md px-3 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                filter.network === network ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-400 hover:text-neutral-200'
              }`}
              data-testid={`bannedvideo-network-${network}`}
            >
              {network === 'ajn' ? 'AJN' : 'RAV'}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-xs text-neutral-400">
          {offlineDemo ? 'DEMO sub-channel' : 'Sub-channel'}
          <select
            value={filter.channel}
            onChange={(e) => applyFilter({ ...filter, channel: e.target.value })}
            disabled={channelOptions.length === 0}
            className="max-w-[16rem] rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            data-testid="bannedvideo-channel-filter"
          >
            <option value="all">All channels</option>
            {channelOptions.map((c) => (
              <option key={c.name} value={c.name}>{c.name} ({c.count})</option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-wide text-neutral-500" data-testid="bannedvideo-pool-status">
            {pool.items.length} in view · {unassigned} not on screen
          </span>
          <button
            type="button"
            onClick={reset}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            data-testid="bannedvideo-reset"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Reset
          </button>
        </div>
      </div>

      {!storageOk && (
        <p className="mb-3 text-xs text-amber-300" role="status">This browser is not saving the wall; panel positions reset when you leave.</p>
      )}

      {filter.network === 'rav' && pool.items.length === 0 ? (
        <p className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-4 text-sm text-neutral-300" role="status" data-testid="bannedvideo-rav-empty">
          {offlineDemo
            ? 'DEMO — this synthetic fixture contains no RAV items.'
            : <>This banned.video snapshot has no Real America&apos;s Voice channels. RAV shows are in the Rumble tab, and they are kept separate from AJN by design.</>}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="bannedvideo-grid">
          {PANEL_INDICES.map((panel) => {
            const id = state.panels[panel];
            const item = id ? pool.byId.get(id) ?? null : null;
            return (
              <BannedVideoPanel
                key={panel}
                panel={panel}
                item={item}
                pool={pool}
                state={state}
                total={total}
                loaded={loaded[panel]}
                note={notes[panel]}
                offlineDemo={offlineDemo}
                simulateEmbedBlocked={simulateEmbedBlocked}
                onLoad={() => setLoaded((current) => current.map((v, i) => (i === panel ? true : v)))}
                onNext={() => next(panel)}
              />
            );
          })}
        </div>
      )}
    </>
  );
}

interface BannedVideoWallProps {
  storage?: WallStorage | null;
  rng?: Rng;
  /** Demo-only: replace remote thumbnails and embeds with local, clearly labelled states. */
  offlineDemo?: boolean;
  simulateEmbedBlocked?: boolean;
  demoSnapshot?: BannedVideoSnapshot;
}

const IS_DEMO_BUILD = import.meta.env?.VITE_AJN_DEMO === "1";

export function BannedVideoWall({ storage = browserWallStorage(), rng = defaultRng, offlineDemo = false, simulateEmbedBlocked = false, demoSnapshot }: BannedVideoWallProps = {}) {
  const safeOfflineDemo = IS_DEMO_BUILD && offlineDemo;
  const check = safeOfflineDemo && demoSnapshot
    ? validateBannedVideoSnapshot(demoSnapshot)
    : BANNED_VIDEO_SNAPSHOT;
  const snapshotError = 'error' in check ? check.error : null;
  return (
    <div className="w-full pb-24 md:pb-10" data-testid="bannedvideo-wall">
      {safeOfflineDemo ? (
        <div className="mb-4 flex h-28 w-full items-center justify-center rounded-lg border border-amber-400/50 bg-gradient-to-r from-neutral-950 via-neutral-800 to-neutral-950 text-center sm:h-40 lg:h-56" data-testid="bannedvideo-demo-banner">
          <span className="rounded border border-amber-300 px-4 py-2 text-sm font-extrabold tracking-[0.2em] text-amber-200">DEMO — synthetic video wall</span>
        </div>
      ) : (
        <img
          src={BANNER_SRC}
          alt="Alex Jones Show · Infowars"
          width={1920}
          height={480}
          className="mb-4 h-auto w-full rounded-lg border border-neutral-800 object-cover"
          data-testid="bannedvideo-banner"
        />
      )}
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-neutral-100">Banned Video</h1>
        {check.ok ? (
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-neutral-400" data-testid="bannedvideo-asof">
            {safeOfflineDemo
              ? `DEMO — synthetic titles, channel names and durations (${check.snapshot.items.length} invented items). No external images, links, or players are used.`
              : <>banned.video trending {pagesLabel(check.snapshot.pages)} as read on {formatScrapedAt(check.snapshot.scrapedAt)} ({check.snapshot.items.length} videos). Rankings change constantly, so this is a snapshot. banned.video players do not autoplay: load a panel, then press play inside it. Panels change only when you press Next, and a video is never on two panels at once.</>}
          </p>
        ) : null}
      </div>
      {check.ok ? (
        <WallBody snapshot={check.snapshot} storage={storage} rng={rng} offlineDemo={safeOfflineDemo} simulateEmbedBlocked={safeOfflineDemo && simulateEmbedBlocked} />
      ) : (
        <p className="rounded-lg border border-red-900 bg-red-950/40 p-4 text-sm text-red-300" role="alert" data-testid="bannedvideo-snapshot-error">
          The banned.video list could not be read: {snapshotError}
        </p>
      )}
    </div>
  );
}

export default BannedVideoWall;
