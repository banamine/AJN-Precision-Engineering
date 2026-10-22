// Home hub: Row 1 live (the existing HomeLiveStrip, unchanged), Today's Digest, Discover, Classic TV coming up, Police Chase reel.
// Every card plays on click. Every row except the live strip collapses (remembered). Nothing here invents data: failures say so and offer Retry.
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Play, Shuffle, X } from 'lucide-react';
import { HomeLiveStrip } from './HomeLiveStrip';
import { LaneImage } from './LaneImage';
import { useClassicUpcoming } from '../hooks/useClassicUpcoming';
import { useDiscoverPool } from '../hooks/useDiscoverPool';
import { useTodaysDigest } from '../hooks/useTodaysDigest';
import { ageLabel, buildDigest, type DigestCard } from '../home/digestModel';
import { requestChannelFocus } from '../guide/focusRequest';
import { saveLastView } from '../nav/lastView';
import {
  JUMP_HOURS, addDismissed, cardsForDay, clearDismissed, dayOf, jumpIndex, nextSeed, pickDiscover, readDismissed, readRowOpen, sessionSeed, writeRowOpen,
  type DayTab, type DiscoverItem, type KV, type RowId, type UpcomingCard,
} from '../home/hubModel';
import type { Destination, PlayProgramCallback } from '../types';

/** Explicit exception to "one player": the reel's cards run their own muted, hidden preview <video> elements (decorative); clicking a card plays through onPlayProgram like everything else. Set false to remove the reel. */
const SHOW_POLICE_CHASE_REEL = true;
const PoliceChaseReel = lazy(() => import('./PoliceChaseReel').then((m) => ({ default: m.PoliceChaseReel })));

const local = (kind: 'local' | 'session'): KV | null => { try { return kind === 'local' ? window.localStorage : window.sessionStorage; } catch { return null; } };
const fmtClock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDur = (s?: number) => (!s ? '' : s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.max(1, Math.round(s / 60))} min`);
const calm = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function useRowOpen(id: RowId, phoneDefault: boolean): [boolean, (v: boolean) => void] {
  const [open, setOpen] = useState(() => readRowOpen(local('local'), id, typeof window !== 'undefined' && window.matchMedia?.('(max-width: 639px)').matches ? phoneDefault : true));
  const set = useCallback((v: boolean) => { setOpen(v); writeRowOpen(local('local'), id, v); }, [id]);
  return [open, set];
}

/** Section header: the title toggles the row (aria-expanded); `actions` sit beside it and never toggle. */
function RowHeader({ id, title, note, open, onToggle, actions }: { id: string; title: string; note?: string; open: boolean; onToggle: () => void; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={`${id}-body`} id={`${id}-heading`}
        className="group flex min-h-[44px] min-w-0 cursor-pointer items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 rounded">
        <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-neutral-500 transition-transform group-hover:text-neutral-300 ${open ? '' : '-rotate-90'}`} />
        <span className="min-w-0">
          <span className="block text-lg font-semibold tracking-tight text-neutral-100">{title}</span>
          {note && <span className="block truncate text-xs text-neutral-500">{note}</span>}
        </span>
      </button>
      {open && actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

function Scroller({ label, children, testId }: { label: string; children: React.ReactNode; testId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const by = (dir: number) => ref.current?.scrollBy({ left: dir * Math.max(240, (ref.current?.clientWidth ?? 600) * 0.8), behavior: calm() ? 'auto' : 'smooth' });
  return (
    <div className="relative">
      <div ref={ref} role="list" aria-label={label} data-testid={testId} className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]">{children}</div>
      <button type="button" aria-label="Scroll back" onClick={() => by(-1)} className="absolute left-0 top-1/2 hidden h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-neutral-950/80 text-neutral-200 ring-1 ring-neutral-700 hover:bg-neutral-900 md:flex"><ChevronLeft className="h-5 w-5" aria-hidden="true" /></button>
      <button type="button" aria-label="Scroll forward" onClick={() => by(1)} className="absolute right-0 top-1/2 hidden h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-neutral-950/80 text-neutral-200 ring-1 ring-neutral-700 hover:bg-neutral-900 md:flex"><ChevronRight className="h-5 w-5" aria-hidden="true" /></button>
    </div>
  );
}

const Skeleton = ({ n = 5, h = 140 }: { n?: number; h?: number }) => (
  <div className="flex gap-3 overflow-hidden" aria-hidden="true">{Array.from({ length: n }, (_, i) => <div key={i} style={{ height: h }} className="w-[220px] shrink-0 animate-pulse rounded-lg bg-neutral-900" />)}</div>
);
const Failure = ({ what, error, onRetry }: { what: string; error: string | null; onRetry: () => void }) => (
  <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-200">
    {what} could not be loaded{error ? ` (${error})` : ''}.
    <button type="button" onClick={onRetry} className="min-h-[44px] cursor-pointer rounded border border-red-700/70 px-2 text-red-100 hover:bg-red-900/40">Try again</button>
  </div>
);
const textBtn = 'inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded border border-neutral-700 px-2.5 text-xs font-medium text-neutral-200 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400';

// ---------------- Row 2: Discover ----------------
function DiscoverRow({ onPlayProgram, dismissed, onDismiss, onClearDismissed, onPicks }: { onPlayProgram: PlayProgramCallback; dismissed: string[]; onDismiss: (key: string) => void; onClearDismissed: () => void; onPicks: (keys: string[]) => void }) {
  const [open, setOpen] = useRowOpen('discover', true);
  const [seed, setSeed] = useState(() => sessionSeed(local('session'), Date.now()));
  const pool = useDiscoverPool(open, seed);
  const picks = useMemo(() => pickDiscover(pool.items, seed, dismissed), [pool.items, seed, dismissed]);
  useEffect(() => { onPicks(picks.map((p) => p.key)); }, [picks, onPicks]);
  const play = (d: DiscoverItem) => onPlayProgram(d.path, d.title, d.categoryLabel, d.mediaType, d.channelId, d.guideId, d.programId, d.sourceId, d.assetId);
  return (
    <section aria-labelledby="hub-discover-heading" className="space-y-2" data-testid="hub-discover">
      <RowHeader id="hub-discover" title="Discover" note="A few picks from across the archive. Same picks while you browse; Shuffle for new ones." open={open} onToggle={() => setOpen(!open)}
        actions={<>
          {dismissed.length > 0 && <button type="button" className={textBtn} onClick={onClearDismissed}>Show hidden ({dismissed.length})</button>}
          <button type="button" className={textBtn} data-testid="discover-shuffle" onClick={() => setSeed(nextSeed(local('session'), seed))}><Shuffle className="h-3.5 w-3.5" aria-hidden="true" /> Shuffle</button>
        </>} />
      {open && (
        <div id="hub-discover-body">
          {pool.phase === 'error' ? <Failure what="Discover" error={pool.error} onRetry={pool.retry} />
            : pool.phase !== 'ready' ? <Skeleton />
            : picks.length === 0 ? <p className="rounded-lg border border-dashed border-neutral-800 p-4 text-sm text-neutral-500">Nothing left to show. <button type="button" className="underline" onClick={() => setSeed(nextSeed(local('session'), seed))}>Shuffle</button> or show hidden items.</p>
            : (
              <Scroller label="Discover" testId="discover-list">
                {picks.map((d) => (
                  <div role="listitem" key={d.key} data-testid="discover-card" className="group relative h-[140px] w-[220px] shrink-0 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
                    {d.thumb && <LaneImage src={d.thumb} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70 transition duration-300 group-hover:scale-105 group-hover:opacity-90" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                    <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/60 to-transparent" />
                    <button type="button" onClick={() => play(d)} aria-label={`Play ${d.title}, ${d.categoryLabel}${d.durSeconds ? `, ${fmtDur(d.durSeconds)}` : ''}`}
                      className="absolute inset-0 flex cursor-pointer flex-col justify-end p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400">
                      <span className="text-[10px] font-mono font-semibold tracking-[0.16em] text-sky-300">{d.categoryLabel.toUpperCase()}{d.mediaType === 'audio' ? ' · AUDIO' : ''}</span>
                      <span className="mt-1 line-clamp-2 text-sm font-semibold leading-snug text-white">{d.title}</span>
                      <span className="mt-0.5 truncate text-[11px] text-neutral-300">{[d.subtitle, fmtDur(d.durSeconds)].filter(Boolean).join(' · ')}</span>
                    </button>
                    <button type="button" onClick={() => onDismiss(d.key)} aria-label={`Not interested in ${d.title}`} title="Not interested"
                      className="absolute right-0 top-0 flex h-11 w-11 cursor-pointer items-center justify-center text-neutral-300 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100 hover:text-white"><X className="h-4 w-4" aria-hidden="true" /></button>
                  </div>
                ))}
              </Scroller>
            )}
          {pool.phase === 'ready' && pool.failed > 0 && <p className="mt-1 text-[11px] text-amber-300/80">{pool.failed} of 8 categories did not load; showing the rest.</p>}
        </div>
      )}
    </section>
  );
}

// ---------------- Row 3: Classic TV, next 48 h ----------------
function ClassicRow({ onPlayProgram, onNavigate }: { onPlayProgram: PlayProgramCallback; onNavigate: (d: Destination) => void }) {
  const [open, setOpen] = useRowOpen('classic48', false);
  const view = useClassicUpcoming(open);
  const [tab, setTab] = useState<DayTab>('today');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(t); }, []);
  const cards = useMemo(() => cardsForDay(view.data?.channels ?? [], tab, now), [view.data, tab, now]);
  const tomorrowCount = useMemo(() => cardsForDay(view.data?.channels ?? [], 'tomorrow', now).length, [view.data, now]);
  const listRef = useRef<HTMLDivElement>(null);
  const jump = (id: string) => {
    const h = JUMP_HOURS.find((j) => j.id === id); if (!h) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-card-index="${jumpIndex(cards, h.hour)}"]`);
    el?.scrollIntoView({ inline: 'start', block: 'nearest', behavior: calm() ? 'auto' : 'smooth' });
  };
  const play = (c: UpcomingCard) => onPlayProgram(c.path, c.title, c.channelName, c.mediaType, c.channelId, 'classic-tv', c.programId, c.sourceId, c.assetId);
  const openGuide = (c: UpcomingCard) => {
    saveLastView({ guideId: 'classic-tv' });
    requestChannelFocus('classic-tv', c.channelId);
    window.dispatchEvent(new CustomEvent('ajn:select-guide', { detail: { guideId: 'classic-tv' } }));
    onNavigate('tv-guide');
  };
  const note = view.data?.stale ? `Saved lineup from ${view.data.generatedAt ? fmtClock(Date.parse(view.data.generatedAt)) : 'earlier'} (live schedule unavailable)` : 'Today and tomorrow. Every item plays on demand from its start; times follow the TV Guide. Tomorrow is partial.';
  return (
    <section aria-labelledby="hub-classic48-heading" className="space-y-2" data-testid="hub-classic48">
      <RowHeader id="hub-classic48" title="Classic TV · coming up" note={note} open={open} onToggle={() => setOpen(!open)}
        actions={<>
          <div role="tablist" aria-label="Day" className="inline-flex overflow-hidden rounded border border-neutral-700">
            {(['today', 'tomorrow'] as const).map((t) => (
              <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)} data-testid={`classic-tab-${t}`}
                className={`min-h-[44px] cursor-pointer px-4 text-xs font-medium ${tab === t ? 'bg-sky-500/20 text-sky-100' : 'text-neutral-300 hover:bg-neutral-800'}`}>{t === 'today' ? 'Today' : 'Tomorrow'}</button>
            ))}
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-neutral-400">
            <span className="sr-only sm:not-sr-only">Jump to</span>
            <select aria-label="Jump to time" defaultValue="" onChange={(e) => { jump(e.target.value); e.target.value = ''; }} data-testid="classic-jump"
              className="min-h-[44px] cursor-pointer rounded border border-neutral-700 bg-neutral-900 px-2 text-xs text-neutral-200">
              <option value="" disabled>Time…</option>
              {JUMP_HOURS.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
            </select>
          </label>
        </>} />
      {open && (
        <div id="hub-classic48-body">
          {view.phase === 'error' && !view.data ? <Failure what="The Classic TV lineup" error={view.error} onRetry={view.retry} />
            : !view.data ? <Skeleton h={156} />
            : view.data.pending ? <p role="status" className="rounded-lg border border-dashed border-neutral-800 p-4 text-sm text-neutral-400" data-testid="classic-pending">The Classic TV schedule is still loading. Checking again shortly.</p>
            : cards.length === 0 ? <p className="rounded-lg border border-dashed border-neutral-800 p-4 text-sm text-neutral-500" data-testid="classic-empty">{tab === 'tomorrow' ? 'Nothing is lined up for tomorrow yet.' : 'Nothing else is scheduled today.'}{tab === 'today' && tomorrowCount > 0 ? <button type="button" className="ml-2 underline" onClick={() => setTab('tomorrow')}>See tomorrow</button> : null}</p>
            : (
              <div ref={listRef}>
                <Scroller label={`Classic TV, ${tab}`} testId="classic-list">
                  {cards.map((c, i) => {
                    const airing = c.startMs <= now && c.endMs > now;
                    return (
                      <div role="listitem" key={`${c.channelId}:${c.programId}:${c.startMs}`} data-card-index={i} data-testid="classic-card" className="flex h-[156px] w-[220px] shrink-0 flex-col rounded-lg border border-neutral-800 bg-neutral-900/70">
                        <button type="button" onClick={() => play(c)} aria-label={`Play ${c.title} from the start, ${c.channelName}, scheduled ${airing ? 'now' : dayOf(c.startMs, now) === 'today' ? 'today' : 'tomorrow'} ${fmtClock(c.startMs)}`}
                          className="flex min-h-0 flex-1 cursor-pointer flex-col rounded-t-lg p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400">
                          <span className={`text-[10px] font-mono font-semibold tracking-[0.16em] ${airing ? 'text-emerald-300' : 'text-amber-300'}`}>{airing ? 'SCHEDULED NOW' : fmtClock(c.startMs)} · {c.channelName.toUpperCase()}</span>
                          <span className="mt-1 line-clamp-2 text-sm font-semibold leading-snug text-white">{c.title}</span>
                          <span className="mt-auto inline-flex items-center gap-1 text-xs font-semibold text-sky-300"><Play className="h-3.5 w-3.5" aria-hidden="true" /> Play from start</span>
                        </button>
                        <button type="button" onClick={() => openGuide(c)} aria-label={`Open ${c.channelName} in the guide`} className="min-h-[44px] w-full cursor-pointer rounded-b-lg border-t border-neutral-800 px-3 text-left text-xs text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400">Open in guide</button>
                      </div>
                    );
                  })}
                </Scroller>
              </div>
            )}
          {view.data && view.error && <p role="status" data-testid="classic-refresh-error" className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-amber-300">Could not refresh ({view.error}); showing the lineup loaded earlier. <button type="button" onClick={view.retry} className="min-h-[44px] cursor-pointer px-1 underline">Try again</button></p>}
          {view.data && !view.data.pending && tab === 'tomorrow' && <p className="mt-1 text-[11px] text-neutral-500">Partial: tomorrow lists only channels whose schedule already runs past midnight, and it can change.</p>}
        </div>
      )}
    </section>
  );
}

// ---------------- Today's Digest ----------------
const DIGEST_SEED_KEY = 'ajn.home.digestSeed';
function DigestRow({ onPlayProgram, dismissed, onDismiss, onClearDismissed, exclude }: { onPlayProgram: PlayProgramCallback; dismissed: string[]; onDismiss: (key: string) => void; onClearDismissed: () => void; exclude: ReadonlySet<string> }) {
  const [open, setOpen] = useRowOpen('digest', true);
  const [seed, setSeed] = useState(() => sessionSeed(local('session'), Date.now(), DIGEST_SEED_KEY));
  const pool = useTodaysDigest(open, seed.split(':')[0]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 5 * 60_000); return () => window.clearInterval(t); }, []);
  const cards = useMemo(() => buildDigest({ fresh: pool.fresh, library: pool.library, seed, nowMs: now, dismissed, exclude }), [pool.fresh, pool.library, seed, now, dismissed, exclude]);
  const newCount = cards.filter((c) => c.tier === 'new').length;
  const play = (c: DigestCard) => onPlayProgram(c.path, c.title, c.showLabel, c.mediaType, c.channelId, c.guideId, c.programId, c.sourceId, c.assetId);
  return (
    <section aria-labelledby="hub-digest-heading" className="space-y-2" data-testid="hub-digest">
      <RowHeader id="hub-digest" title="Today's Digest" note="New from AJN first, then random picks from the whole library. Audio and video." open={open} onToggle={() => setOpen(!open)}
        actions={<>
          {dismissed.length > 0 && <button type="button" className={textBtn} onClick={onClearDismissed}>Show hidden ({dismissed.length})</button>}
          <button type="button" className={textBtn} data-testid="digest-shuffle" onClick={() => setSeed(nextSeed(local('session'), seed, DIGEST_SEED_KEY))}><Shuffle className="h-3.5 w-3.5" aria-hidden="true" /> Shuffle</button>
        </>} />
      {open && (
        <div id="hub-digest-body">
          {pool.phase === 'error' ? <Failure what="Today's Digest" error={pool.error} onRetry={pool.retry} />
            : pool.phase !== 'ready' ? <Skeleton />
            : cards.length === 0 ? <p className="rounded-lg border border-dashed border-neutral-800 p-4 text-sm text-neutral-500">Nothing left to show. <button type="button" className="underline" onClick={() => setSeed(nextSeed(local('session'), seed, DIGEST_SEED_KEY))}>Shuffle</button> or restore hidden items.</p>
            : (
              <Scroller label="Today's Digest" testId="digest-list">
                {cards.map((c) => (
                  <div role="listitem" key={c.key} data-testid="digest-card" data-tier={c.tier} className="group relative h-[140px] w-[220px] shrink-0 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
                    {c.thumb && <LaneImage src={c.thumb} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70 transition duration-300 group-hover:scale-105 group-hover:opacity-90" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                    <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/60 to-transparent" />
                    <button type="button" onClick={() => play(c)} aria-label={`Play ${c.title}, ${c.showLabel}${c.tier === 'new' && c.publishedMs ? `, new, ${ageLabel(c.publishedMs, now)}` : ''}, ${c.mediaType}`}
                      className="absolute inset-0 flex cursor-pointer flex-col justify-end p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400">
                      <span className={`text-[10px] font-mono font-semibold tracking-[0.16em] ${c.tier === 'new' ? 'text-emerald-300' : 'text-sky-300'}`}>
                        {c.tier === 'new' && c.publishedMs ? `NEW · ${ageLabel(c.publishedMs, now).toUpperCase()}` : c.showLabel.toUpperCase()}{c.mediaType === 'audio' ? ' · AUDIO' : ' · VIDEO'}
                      </span>
                      <span className="mt-1 line-clamp-2 text-sm font-semibold leading-snug text-white">{c.title}</span>
                      <span className="mt-0.5 truncate text-[11px] text-neutral-300">{[c.tier === 'new' ? c.showLabel : c.subtitle, fmtDur(c.durSeconds)].filter(Boolean).join(' · ')}</span>
                    </button>
                    <button type="button" onClick={() => onDismiss(c.key)} aria-label={`Not interested in ${c.title}`} title="Not interested"
                      className="absolute right-0 top-0 flex h-11 w-11 cursor-pointer items-center justify-center text-neutral-300 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100 hover:text-white"><X className="h-4 w-4" aria-hidden="true" /></button>
                  </div>
                ))}
              </Scroller>
            )}
          {pool.phase === 'ready' && <p className="mt-1 text-[11px] text-neutral-500" data-testid="digest-counts">{newCount} new from AJN · {cards.length - newCount} from the archive</p>}
          {pool.phase === 'ready' && pool.feedsFailed > 0 && <p role="status" className="mt-1 text-[11px] text-amber-300/80" data-testid="digest-feeds-failed">{pool.feedsFailed} of 5 AJN feeds did not load; some new items may be missing.</p>}
          {pool.phase === 'ready' && pool.librarySourcesFailed > 0 && <p role="status" className="mt-1 text-[11px] text-amber-300/80">{pool.librarySourcesFailed} library request{pool.librarySourcesFailed === 1 ? '' : 's'} failed; showing what loaded.</p>}
        </div>
      )}
    </section>
  );
}

// ---------------- Police Chase reel (collapsible) ----------------
function ReelRow({ onPlayProgram }: { onPlayProgram: PlayProgramCallback }) {
  const [open, setOpen] = useRowOpen('reel', false); // closed by default on phones: it runs muted preview videos
  return (
    <section aria-labelledby="hub-reel-heading" className="space-y-2" data-testid="hub-reel">
      <RowHeader id="hub-reel" title="Police Chase" note="Random previews, muted · viewer discretion" open={open} onToggle={() => setOpen(!open)} />
      {open && (
        <div id="hub-reel-body">
          <Suspense fallback={<div className="h-[188px]" aria-hidden="true" />}>
            <PoliceChaseReel onPlayProgram={onPlayProgram} hideHeading />
          </Suspense>
        </div>
      )}
    </section>
  );
}

// ---------------- Hub ----------------
export function HomeBroadcastHub({ onPlayProgram, onNavigate }: { onPlayProgram: PlayProgramCallback; onNavigate: (d: Destination) => void }) {
  // "Not interested" is one list shared by Today's Digest and Discover; Discover's visible picks are kept out of the Digest so a card never appears twice.
  const [dismissed, setDismissed] = useState<string[]>(() => readDismissed(local('local')));
  const onDismiss = useCallback((key: string) => setDismissed(addDismissed(local('local'), key)), []);
  const onClearDismissed = useCallback(() => { clearDismissed(local('local')); setDismissed([]); }, []);
  const [discoverKeys, setDiscoverKeys] = useState<ReadonlySet<string>>(() => new Set());
  const onPicks = useCallback((keys: string[]) => setDiscoverKeys((prev) => (prev.size === keys.length && keys.every((k) => prev.has(k)) ? prev : new Set(keys))), []);
  return (
    <div className="space-y-10" data-testid="home-broadcast-hub">
      <HomeLiveStrip onPlayProgram={onPlayProgram} onNavigate={onNavigate} />
      <DigestRow onPlayProgram={onPlayProgram} dismissed={dismissed} onDismiss={onDismiss} onClearDismissed={onClearDismissed} exclude={discoverKeys} />
      <DiscoverRow onPlayProgram={onPlayProgram} dismissed={dismissed} onDismiss={onDismiss} onClearDismissed={onClearDismissed} onPicks={onPicks} />
      <ClassicRow onPlayProgram={onPlayProgram} onNavigate={onNavigate} />
      {SHOW_POLICE_CHASE_REEL && <ReelRow onPlayProgram={onPlayProgram} />}
    </div>
  );
}
