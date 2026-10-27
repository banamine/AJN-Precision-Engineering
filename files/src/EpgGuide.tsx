import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback, useDeferredValue } from "react";
import { ScheduleChannel, Program, MediaType, PlayProgramCallback } from "./types";
import { Tv, Radio, Disc3, Sparkles, Play, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { ShowInfoButton } from "./components/ShowInfoButton";
import { ChannelLogo } from './components/ChannelLogo';
import { ajnArtFor } from './utils/ajnArt';
import { LazyThumb } from './components/LazyThumb';
import { ALL_CATEGORIES, buildSearchIndex, categoryCounts, filterChannels, numberChannels, stationLabel, type SearchIndex } from './guide/channelIndex';
import { FOCUS_EVENT, peekChannelFocus, takeChannelFocus } from "./guide/focusRequest";
import { buildFallbackShowInfo } from "./showinfo/fallback";
import { getCachedSchedule, isStale, setCachedSchedule } from "./guide/scheduleCache";
import { groupProgramsForGrid, isMusicChannel, type GridBlock } from "./guide/groupProgramsForGrid";
import { BlockCell, NowPlayingLine, TrackDrawer } from "./guide/BlockCell";
import { findLiveProgram, tuneIn, mediaTypeFor, isLiveStream, type LiveItem } from "./guide/liveTune";
import { computeWindow, panBy, intersects, clipToWindow, redLineLeft, type TimeWindow } from "./guide/timeWindow";
import { loadLastView, saveLastView, VALID_DESTINATIONS } from "./nav/lastView";
import { loadFilterPrefs, saveFilterPrefs } from "./guide/filterPrefs";

const DEFAULT_VIEW_WIDTH_PX = 960; // used until the real width is measured (and in server-side tests)
const CHANNEL_COLUMN_WIDTH_PX = 272;
const ROW_HEIGHT_PX = 68;
/** Audio stations get more vertical room so station numbers, thumbnails and track blocks do not touch. */
export const AUDIO_ROW_HEIGHT_PX = 84;

function hourLabel(hour: number): string {
  const h = Math.floor(hour) % 24;
  const period = h < 12 ? "AM" : "PM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}${period}`;
}

/** Grid hours for a program. Listings timed in UTC (Live TV from Pluto) are
 *  placed in the viewer's local day and clipped to it; others use their hours. */
function withLocalHours(program: Program): { program: Program; sHour: number; eHour: number } {
  if ((program.metadata as any)?.epg === 'utc' && program.startTimeUtc && program.endTimeUtc) {
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const h = (iso: string) => (Date.parse(iso) - midnight.getTime()) / 3_600_000;
    return { program, sHour: Math.max(0, h(program.startTimeUtc)), eHour: Math.min(24, h(program.endTimeUtc)) };
  }
  return { program, sHour: program.startHour ?? program.startTime ?? 0, eHour: program.endHour ?? program.endTime ?? 24 };
}

function currentHourFraction(): number {
  const now = new Date();
  return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
}

interface EpgGuideProps {
  guideId?: string;
  active?: boolean;
  /** Called with archive path, title, channel name, and mediaType when a program block is clicked. */
  onSelectProgram?: PlayProgramCallback;
}

/** Also used by hermetic render/click tests; no player or browser dependencies. */
export function EpgProgramBlock({ program, channel, guideId, idx, isLive, left, width, onSelectProgram, tune }: {
  program: Program; channel: ScheduleChannel; guideId: string; idx: number;
  isLive: boolean; left: number; width: number; onSelectProgram?: PlayProgramCallback;
  /** When set and the block is on air, a click joins at the clock time instead of the start. */
  tune?: { sHour: number; eHour: number; nowHour: () => number };
}) {
  const mediaType = program.mediaType || channel.mediaType || (guideId === 'audio-podcasts' ? 'audio' : 'video');
  const isManifestRow = typeof program.metadata?.manifestId === 'string';
  const thumbnail = program.metadata?.thumbnailUrl;
  const useBackgroundThumbnail = width < 150;
  return (
    <button
      type="button"
      id={`epg-prog-${channel.id}-${idx}`}
      title={program.title}
      aria-label={`${program.title}, ${channel.name}`}
      onClick={() => {
        const sourceId = program.sourceId ?? program.metadata?.sourceId;
        const assetId = program.assetId ?? program.metadata?.assetId;
        if (isLive && tune) {
          const t = tuneIn(program, tune.sHour, tune.eHour, tune.nowHour());
          onSelectProgram?.(t.path, program.title, channel.name, mediaType, channel.id, program.guideId, program.id, sourceId, assetId, t.startAtSeconds);
          return;
        }
        onSelectProgram?.(program.archivePath || program.mediaUrl, program.title, channel.name, mediaType, channel.id, program.guideId, program.id, sourceId, assetId);
      }}
      className={`group absolute isolate top-1.5 flex h-[calc(100%-0.75rem)] flex-col justify-center overflow-hidden rounded-lg px-3 text-left text-xs transition hover:scale-[1.005] hover:z-10 cursor-pointer ${
        channel.highlight === 'must-listen'
          ? isLive
            ? "border border-fuchsia-300/80 bg-fuchsia-500/30 text-fuchsia-50 shadow-md shadow-fuchsia-500/20"
            : "border border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-100 hover:border-fuchsia-400/70 hover:bg-fuchsia-500/20"
          : isLive
          ? mediaType === 'audio'
            ? "border border-amber-500/50 bg-amber-500/15 text-amber-100 shadow-md shadow-amber-500/5"
            : "border border-sky-500/50 bg-sky-500/15 text-sky-100 shadow-md shadow-sky-500/5"
          : "border border-neutral-800 bg-neutral-900/80 text-neutral-300 hover:border-neutral-700 hover:bg-neutral-800"
      }`}
      style={{ left, width: Math.max(width - 4, 20) }}
    >
      {isManifestRow && useBackgroundThumbnail && typeof thumbnail === 'string' && (
        <img
          src={thumbnail}
          alt=""
          loading="lazy"
          onError={(e) => { (e.currentTarget as HTMLElement).style.display = 'none'; }}
          className="pointer-events-none absolute inset-0 z-0 h-full w-full rounded-lg object-cover opacity-30"
        />
      )}
      {isLive && (
        <span className={`relative z-10 mb-0.5 inline-flex w-fit items-center gap-1 text-[10px] font-semibold uppercase tracking-wider ${
          mediaType === 'audio' ? 'text-amber-400' : 'text-sky-400'
        }`}>
          <span className={`h-1.5 w-1.5 rounded-full animate-pulse ${
            mediaType === 'audio' ? 'bg-amber-400' : 'bg-sky-400'
          }`} />
          On Air Now
          {mediaType !== 'audio' && !isLiveStream(program) && (
            <span data-testid="replay-tag" className="rounded bg-neutral-700/70 px-1 py-px text-[9px] font-bold tracking-wide text-neutral-200">REPLAY</span>
          )}
        </span>
      )}
      <span className="relative z-10 flex min-w-0 items-center gap-1.5">
        {isManifestRow && !useBackgroundThumbnail && typeof thumbnail === 'string' && (
          <img
            src={thumbnail}
            alt=""
            loading="lazy"
            onError={(e) => { (e.currentTarget as HTMLElement).style.display = 'none'; }}
            className="h-7 w-9 shrink-0 rounded object-cover"
          />
        )}
        <span className="relative z-10 truncate font-semibold text-neutral-100 group-hover:text-white">{program.title}</span>
      </span>
      {program.description && (
        <span className="relative z-10 truncate text-[10px] text-neutral-400">{program.description}</span>
      )}
    </button>
  );
}

export default function EpgGuide({ guideId = 'cable-tv', onSelectProgram, active = true }: EpgGuideProps) {
  const rowH = guideId === 'audio-podcasts' ? AUDIO_ROW_HEIGHT_PX : ROW_HEIGHT_PX;
  const [nowHour, setNowHour] = useState(currentHourFraction());
  const [channels, setChannels] = useState<ScheduleChannel[] | null>(() => getCachedSchedule(guideId)?.channels ?? null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(() => !getCachedSchedule(guideId));
  // Short window that follows the red line: no side-scrolling to find what is on now.
  const [viewEl, setViewEl] = useState<HTMLDivElement | null>(null);
  const [viewWidth, setViewWidth] = useState(DEFAULT_VIEW_WIDTH_PX);
  const [panStart, setPanStart] = useState<number | null>(null);
  const [preferredHours, setPreferredHours] = useState<number | null>(null);
  useEffect(() => {
    if (!viewEl) return;
    const measure = () => { const w = viewEl.clientWidth; if (w > 0) setViewWidth(w); };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(viewEl);
    return () => ro.disconnect();
  }, [viewEl]);
  const win: TimeWindow = useMemo(() => computeWindow(nowHour, viewWidth, panStart, preferredHours), [nowHour, viewWidth, panStart, preferredHours]);
  const pxPerHour = win.pxPerHour;
  const timelineWidthPx = pxPerHour * 24;
  const [savedView] = useState(() => loadLastView(VALID_DESTINATIONS));
  const hasRestoredScroll = useRef(false);
  const restoringScroll = useRef(false);
  const lastScroll = useRef<{ scrollY: number; scrollX: number } | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const lastScrollSaveAt = useRef(0);
  const scrollSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasChannels = channels !== null;

  const requestRef = useRef<AbortController | null>(null);
  const fetchSchedule = useCallback(async () => {
    // Only the latest guide request may update the grid; switching guides aborts
    // the previous one so a slow guide can't overwrite the one on screen.
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      if (!getCachedSchedule(guideId)) setIsLoading(true);
      setFetchError(null);
      // tz: the server windows looped music channels around this viewer's local hour (the grid draws on the local clock).
      const res = await fetch(`/api/schedule?guide=${encodeURIComponent(guideId)}&tz=${new Date().getTimezoneOffset()}`, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`Schedule request failed: HTTP ${res.status}`);
      }
      const data = await res.json();
      if (!Array.isArray(data.channels)) {
        throw new Error('Schedule response missing channels array');
      }
      if (data.channels.length === 0) {
        throw new Error('Schedule response returned no channels');
      }
      if (controller.signal.aborted) return;
      setCachedSchedule(guideId, data.channels);
      setChannels(data.channels);
    } catch (err) {
      if (controller.signal.aborted) return;
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, [guideId]);

  useEffect(() => {
    if (!active) return;
    const entry = getCachedSchedule(guideId);
    if (entry) {
      setChannels(entry.channels);
      setIsLoading(false);
      setFetchError(null);
    } else {
      setChannels(null);
      setIsLoading(true);
      setFetchError(null);
    }
    if (!entry || isStale(entry)) void fetchSchedule();
    return () => requestRef.current?.abort();
  }, [fetchSchedule, guideId, active]);

  // Background news refresh promoted by the user: reload this guide in place.
  useEffect(() => {
    const onUpdate = (e: Event) => { if ((e as CustomEvent).detail?.guideId === guideId) void fetchSchedule(); };
    window.addEventListener("ajn:schedule-updated", onUpdate);
    return () => window.removeEventListener("ajn:schedule-updated", onUpdate);
  }, [fetchSchedule, guideId]);

  // Live "now" line — updates every 30s, real time, not a static mockup.
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => setNowHour(currentHourFraction()), 30_000);
    return () => clearInterval(interval);
  }, [active]);

  // Large guides (Live TV ~1,300 rows, documentaries) render in pages of 40
  // rows; the next page loads when the bottom sentinel scrolls into view.
  const PAGE_ROWS = 40;
  // Include the rows needed for a saved vertical position before restoring it.
  const [visibleCount, setVisibleCount] = useState(() =>
    Math.max(PAGE_ROWS, Math.ceil((savedView?.scrollY ?? 0) / rowH) + PAGE_ROWS));
  const sentinelRef = useRef<HTMLDivElement>(null);
  const previousGuideId = useRef(guideId);
  useEffect(() => {
    if (previousGuideId.current === guideId) return;
    previousGuideId.current = guideId;
    setVisibleCount(PAGE_ROWS);
  }, [guideId]);
  // Alphabetical lineup with sequential station numbers (1..N over the whole guide), category filter and instant search.
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>(() => loadFilterPrefs(guideId).category);
  const [onNowOnly, setOnNowOnly] = useState<boolean>(() => loadFilterPrefs(guideId).onNow);
  // A different guide brings that guide's own remembered filters.
  const prefsGuide = useRef(guideId);
  useEffect(() => {
    if (prefsGuide.current === guideId) return;
    prefsGuide.current = guideId;
    const p = loadFilterPrefs(guideId);
    setCategory(p.category); setOnNowOnly(p.onNow);
  }, [guideId]);
  useEffect(() => { if (prefsGuide.current === guideId) saveFilterPrefs(guideId, { category, onNow: onNowOnly }); }, [guideId, category, onNowOnly]);
  // Home's "See all in Guide" asks this (already open) guide to show one category; an unknown category is dropped by the check below.
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as { guideId?: string; category?: string } | undefined;
      if (d?.guideId === guideId && typeof d.category === 'string') { setCategory(d.category); setOnNowOnly(false); }
    };
    window.addEventListener('ajn:guide-filter', on);
    return () => window.removeEventListener('ajn:guide-filter', on);
  }, [guideId]);
  const deferredQuery = useDeferredValue(query);
  const hasQuery = deferredQuery.trim().length > 0;
  const numbered = useMemo(() => numberChannels(channels ?? []), [channels]);
  const stationOf = useMemo(() => new Map(numbered.map((n) => [n.channel.id, n.station])), [numbered]);
  const categories = useMemo(() => categoryCounts(numbered), [numbered]);
  const searchIndex = useMemo<SearchIndex>(() => (hasQuery ? buildSearchIndex(numbered) : new Map()), [numbered, hasQuery]);
  // "On now": a channel qualifies when one of its programs covers the current local time (same hours the grid draws).
  const onNowTest = useMemo(() => (onNowOnly
    ? (c: ScheduleChannel) => (c.programs ?? []).some((p) => { const w = withLocalHours(p); return nowHour >= w.sHour && nowHour < w.eHour; })
    : undefined), [onNowOnly, nowHour]);
  const filtered = useMemo(() => filterChannels(numbered, searchIndex, deferredQuery, category, onNowTest), [numbered, searchIndex, deferredQuery, category, onNowTest]);
  // Only drop a remembered category once the channel list has really loaded (it is empty while loading).
  useEffect(() => { if (channels !== null && channels.length > 0 && category !== ALL_CATEGORIES && !categories.some((c) => c.id === category)) setCategory(ALL_CATEGORIES); }, [channels, categories, category]);
  const filterMounted = useRef(false);
  useEffect(() => {
    if (!filterMounted.current) { filterMounted.current = true; return; } // keep the saved scroll position on first mount
    setVisibleCount(PAGE_ROWS);
  }, [deferredQuery, category, onNowOnly]);
  const visible = useMemo(() => filtered.rows.slice(0, visibleCount).map((r) => r.channel), [filtered, visibleCount]);
  const hasMore = filtered.rows.length > visibleCount;

  // Land on one channel (Home tile / link): wait for this guide's schedule, clear filters that could hide it, mount its page
  // of rows, scroll it to the middle and flash it. A request for a channel that is not in the guide is dropped after 15 s.
  const [focusId, setFocusId] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent).detail?.guideId === guideId) setFocusTick((n) => n + 1); };
    window.addEventListener(FOCUS_EVENT, on);
    return () => window.removeEventListener(FOCUS_EVENT, on);
  }, [guideId]);
  useEffect(() => {
    if (!active || channels === null) return;
    const req = peekChannelFocus(guideId);
    if (!req || !numbered.some((n) => n.channel.id === req.channelId)) return;
    takeChannelFocus(guideId);
    setQuery(''); setCategory(ALL_CATEGORIES); setOnNowOnly(false); setVisibleCount(PAGE_ROWS);
    setFocusId(req.channelId);
  }, [active, channels, numbered, guideId, focusTick]);
  useEffect(() => {
    if (!focusId || deferredQuery.trim() !== '' || category !== ALL_CATEGORIES || onNowOnly) return;
    const idx = filtered.rows.findIndex((r) => r.channel.id === focusId);
    if (idx < 0) return;
    if (idx >= visibleCount) { setVisibleCount(idx + PAGE_ROWS); return; }
    const el = Array.from(document.querySelectorAll('[data-channel-id]')).find((n) => n.getAttribute('data-channel-id') === focusId);
    if (!el) return;
    const calm = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
    setFlashId(focusId); setFocusId(null);
  }, [focusId, filtered, visibleCount, deferredQuery, category, onNowOnly]);
  useEffect(() => {
    if (!flashId) return;
    const t = window.setTimeout(() => setFlashId(null), 2500);
    return () => window.clearTimeout(t);
  }, [flashId]);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setVisibleCount((n) => n + PAGE_ROWS);
    }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, visible.length]);

  // Storage is restored once per mount. Later activations use the position
  // retained in memory, since hiding this view can shrink the document.
  useLayoutEffect(() => {
    if (!active || !hasChannels) return;
    if (!hasRestoredScroll.current) {
      lastScroll.current = { scrollY: savedView?.scrollY ?? window.scrollY, scrollX: 0 };
      hasRestoredScroll.current = true;
    }
    const position = lastScroll.current;
    if (!position) return;
    restoringScroll.current = true;
    window.scrollTo(window.scrollX, position.scrollY);
    const frame = requestAnimationFrame(() => { restoringScroll.current = false; });
    return () => cancelAnimationFrame(frame);
  }, [active, hasChannels]);

  useEffect(() => {
    if (!active || !hasChannels) return;
    const persist = () => {
      scrollSaveTimer.current = null;
      if (!lastScroll.current) return;
      lastScrollSaveAt.current = Date.now();
      saveLastView(lastScroll.current);
    };
    const onScroll = () => {
      if (!activeRef.current || restoringScroll.current || !hasRestoredScroll.current) return;
      lastScroll.current = { scrollY: window.scrollY, scrollX: 0 };
      const remaining = 300 - (Date.now() - lastScrollSaveAt.current);
      if (remaining <= 0) {
        if (scrollSaveTimer.current !== null) clearTimeout(scrollSaveTimer.current);
        persist();
      } else if (scrollSaveTimer.current === null) {
        scrollSaveTimer.current = setTimeout(persist, remaining);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
    };
  }, [active, hasChannels]);

  useEffect(() => () => {
    if (scrollSaveTimer.current !== null) clearTimeout(scrollSaveTimer.current);
  }, []);

  const [drawer, setDrawer] = useState<{ channel: ScheduleChannel; block: GridBlock; opener: HTMLElement } | null>(null);
  const grouped = useMemo(() => {
    const m = new Map<string, ReturnType<typeof groupProgramsForGrid>>();
    for (const c of visible) if (isMusicChannel(c)) m.set(c.id, groupProgramsForGrid(c, pxPerHour, nowHour));
    return m;
  }, [visible, nowHour, pxPerHour]);

  // Exact track-boundary refresh for music rows (in addition to the 30s tick).
  useEffect(() => {
    if (!active) return;
    let next = Infinity;
    grouped.forEach((g) => { if (g.liveItem && g.liveItem.eHour > nowHour) next = Math.min(next, g.liveItem.eHour); });
    if (!isFinite(next)) return;
    const t = setTimeout(() => setNowHour(currentHourFraction()), Math.max(50, (next - nowHour) * 3_600_000 + 100));
    return () => clearTimeout(t);
  }, [grouped, nowHour, active]);

  const hourMarkers = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);
  const nowLeftPx = redLineLeft(nowHour, win);
  const playLive = useCallback((channel: ScheduleChannel, item: LiveItem | null) => {
    if (!item) return;
    const now = currentHourFraction();
    const t = tuneIn(item.program, item.sHour, item.eHour, now);
    const p = item.program;
    onSelectProgram?.(t.path, p.title, channel.name, mediaTypeFor(p, channel, guideId), channel.id, p.guideId, p.id, p.sourceId ?? p.metadata?.sourceId, p.assetId ?? p.metadata?.assetId, t.startAtSeconds);
  }, [onSelectProgram, guideId]);

  if (fetchError && !getCachedSchedule(guideId)) {
    return (
      <div className="w-full rounded-xl border border-red-900/50 bg-red-950/20 p-8 text-center text-sm text-red-300 space-y-3">
        <p>Error fetching guide: {fetchError}</p>
        <button
          onClick={fetchSchedule}
          className="rounded-lg border border-red-800 bg-red-900/40 px-3 py-1.5 text-xs text-red-200 hover:bg-red-900/70 cursor-pointer"
        >
          Retry Fetch
        </button>
      </div>
    );
  }

  if (isLoading || channels === null) {
    return (
      <div className="w-full rounded-xl border border-neutral-800 bg-neutral-950 p-12 text-center text-sm text-neutral-400">
        <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-sky-500 border-t-transparent mb-3" />
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="w-full overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 shadow-2xl">
      {fetchError && (
        <p role="status" className="border-b border-neutral-800 px-3.5 py-2 text-xs text-amber-300">
          Couldn't refresh the guide. Showing the last loaded version.
        </p>
      )}
      <div className="space-y-2 border-b border-neutral-800 bg-neutral-900/40 px-3 py-2.5" data-epg-filters>
        <div className="flex items-center gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search channels and shows</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }}
              placeholder="Search channels, shows or station number…" autoComplete="off" spellCheck={false} data-testid="epg-search"
              className="h-8 w-full rounded-lg border border-neutral-700 bg-neutral-950 pl-8 pr-8 text-xs text-neutral-100 placeholder:text-neutral-500 focus:border-sky-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50" />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Clear search" data-testid="epg-search-clear"
                className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 cursor-pointer"><X className="h-3 w-3" /></button>
            )}
          </label>
          <button type="button" aria-pressed={onNowOnly} onClick={() => setOnNowOnly((v) => !v)} data-testid="epg-on-now"
            title="Only channels with a program on right now"
            className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 ${
              onNowOnly ? 'border-red-500/70 bg-red-500/20 text-red-100' : 'border-neutral-700 text-neutral-300 hover:bg-neutral-800'}`}>
            <span className={`h-2 w-2 rounded-full ${onNowOnly ? 'bg-red-400 animate-pulse' : 'bg-neutral-500'}`} />On now
          </button>
          <span role="status" aria-live="polite" data-testid="epg-result-count" className="shrink-0 text-[11px] tabular-nums text-neutral-400">
            {filtered.rows.length === numbered.length ? `${numbered.length} channels` : `${filtered.rows.length} of ${numbered.length}`}
          </span>
        </div>
        {categories.length > 1 && (
          <div role="group" aria-label="Filter by category" className="flex gap-1.5 overflow-x-auto pb-0.5" data-testid="epg-categories">
            {[{ id: ALL_CATEGORIES, label: 'All', count: numbered.length }, ...categories].map((c) => (
              <button key={c.id} type="button" aria-pressed={category === c.id} onClick={() => setCategory(c.id)} data-category={c.id}
                className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                  category === c.id ? 'border-sky-500/60 bg-sky-500/20 text-sky-100' : 'border-neutral-700 text-neutral-300 hover:bg-neutral-800'}`}>
                {c.label} <span className="tabular-nums text-neutral-500">{c.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {filtered.rows.length === 0 && (
        <div role="status" data-testid="epg-no-match" className="p-10 text-center text-sm text-neutral-400">
          No channels or shows match{hasQuery ? <> “{query.trim()}”</> : null}{category !== ALL_CATEGORIES ? ' in this category' : ''}{onNowOnly ? ' that are on right now' : ''}.
          <button type="button" onClick={() => { setQuery(''); setCategory(ALL_CATEGORIES); setOnNowOnly(false); }} className="ml-3 rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-200 hover:bg-neutral-800 cursor-pointer">Clear filters</button>
        </div>
      )}
        <div className="flex items-center gap-1.5 border-b border-neutral-800 bg-neutral-900/50 px-3 py-1.5" data-epg-toolbar>
          <span className="mr-auto text-[11px] text-neutral-400">{hourLabel(win.startHour)} – {hourLabel(win.endHour)} · follows the red line</span>
          <button type="button" onClick={() => setPanStart(panBy(win, -1))} aria-label="Earlier" title="Earlier"
            className="flex h-6 w-6 items-center justify-center rounded border border-neutral-700 text-neutral-300 hover:bg-neutral-800 cursor-pointer"><ChevronLeft className="h-3 w-3" /></button>
          <button type="button" onClick={() => setPanStart(null)} aria-label="Jump to now" title="Jump to now"
            className={`rounded border px-1.5 text-[10px] font-semibold uppercase cursor-pointer ${panStart === null ? 'border-red-500/50 text-red-300' : 'border-neutral-600 text-neutral-200 hover:bg-neutral-800'}`}>Now</button>
          <button type="button" onClick={() => setPanStart(panBy(win, 1))} aria-label="Later" title="Later"
            className="flex h-6 w-6 items-center justify-center rounded border border-neutral-700 text-neutral-300 hover:bg-neutral-800 cursor-pointer"><ChevronRight className="h-3 w-3" /></button>
          <select aria-label="Hours shown" value={preferredHours ?? 'auto'} onChange={(e) => setPreferredHours(e.target.value === 'auto' ? null : Number(e.target.value))}
            className="h-6 rounded border border-neutral-700 bg-neutral-900 px-1 text-[10px] text-neutral-300 cursor-pointer">
            <option value="auto">Auto</option><option value="3">3h</option><option value="4">4h</option><option value="6">6h</option><option value="8">8h</option>
          </select>
        </div>
      <div className="flex">
        {/* ── Sticky channel column ─────────────────────────────────────── */}
        <div
          className="flex-shrink-0 border-r border-neutral-800 bg-neutral-950 z-20"
          style={{ width: CHANNEL_COLUMN_WIDTH_PX }}
        >
          {/* Spacer matching the timeline header height */}
          <div className="h-11 border-b border-neutral-800 flex items-center px-3.5 text-xs font-semibold text-neutral-400 uppercase tracking-wider bg-neutral-900/70">
            Station / Feed
          </div>
          {visible.map((channel) => {
            const isAudio = channel.mediaType === 'audio' || guideId === 'audio-podcasts';
            const liveItem: LiveItem | null = grouped.get(channel.id)?.liveItem ?? findLiveProgram(channel, nowHour);
            const liveTitle = liveItem?.program.title;
            return (
              <div
                key={channel.id}
                data-highlight={channel.highlight}
                data-channel-id={channel.id}
                className={`flex flex-col justify-center border-b border-neutral-800 px-3.5 ${flashId === channel.id ? 'bg-amber-500/15 ring-2 ring-inset ring-amber-400/70 ' : ''}${channel.highlight === 'must-listen' ? 'border-l-4 border-l-fuchsia-400 bg-gradient-to-r from-fuchsia-500/20 via-fuchsia-500/5 to-transparent' : ''}`}
                style={{ height: rowH }}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span data-testid="station-number" title={`Station ${stationOf.get(channel.id)}`} className="w-8 shrink-0 text-right font-mono text-[11px] font-semibold tabular-nums text-neutral-400">{stationLabel(stationOf.get(channel.id) ?? 0)}</span>
                  <ChannelLogo logo={channel.logo} name={channel.name} fallback={
                    <LazyThumb title={channel.name} input={{
                      path: liveItem?.program.archivePath ?? liveItem?.program.mediaUrl ?? channel.programs[0]?.archivePath ?? channel.programs[0]?.mediaUrl ?? null,
                      guideId, channelId: channel.id, category: channel.group ?? null, mediaType: channel.mediaType, name: channel.name,
                      placeholder: ajnArtFor({ show: `${channel.name} ${channel.group ?? ''}`, mediaType: channel.mediaType, onlyAjn: true }),
                    }} />
                  } />
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-neutral-100" title={channel.name}>
                    {channel.name}
                  </span>
                  <button
                    type="button"
                    data-play-live={channel.id}
                    disabled={!liveItem}
                    onClick={() => playLive(channel, liveItem)}
                    title={liveItem ? `Play ${liveTitle} from the red line (${channel.name})` : `${channel.name}: nothing scheduled right now`}
                    aria-label={liveItem ? `Play ${channel.name} now: ${liveTitle}` : `${channel.name}: nothing on air now`}
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${
                      liveItem
                        ? (isAudio ? 'border-amber-500/50 bg-amber-500/15 text-amber-300 hover:bg-amber-500/30' : 'border-sky-500/50 bg-sky-500/15 text-sky-300 hover:bg-sky-500/30') + ' cursor-pointer'
                        : 'border-neutral-800 text-neutral-600 cursor-not-allowed'
                    }`}
                  >
                    <Play className="h-3 w-3 fill-current" />
                  </button>
                  {channel.id !== 'item-unsorted' && <ShowInfoButton channelId={channel.id} title={channel.name} fallback={buildFallbackShowInfo(channel)} />}
                </div>
                {filtered.matchedShow.has(channel.id) && (
                  <span data-testid="matched-show" className="mt-0.5 truncate pl-10 text-[10px] text-sky-300" title={filtered.matchedShow.get(channel.id)}>↳ {filtered.matchedShow.get(channel.id)}</span>
                )}
                <div className="flex items-center gap-1.5 mt-1 pl-10">
                  {channel.highlight === 'must-listen' && (
                    <span data-testid="must-listen-badge" className="shrink-0 rounded bg-fuchsia-500 px-1.5 py-px text-[9px] font-extrabold uppercase tracking-wider text-white shadow shadow-fuchsia-500/40">★ Must listen</span>
                  )}
                  <span className="text-[10px] font-mono text-neutral-400 truncate" title={channel.group || undefined}>
                    {channel.group || (isAudio ? 'Audio Stream' : 'Video Feed')}
                  </span>
                </div>
                {grouped.has(channel.id) && (
                  <NowPlayingLine channelId={channel.id} item={grouped.get(channel.id)?.liveItem ?? null} nowHour={nowHour} />
                )}
              </div>
            );
          })}
        </div>

        {/* ── Windowed timeline: follows the red line, no side-scrolling ── */}
        <div className="min-w-0 flex-1">
          <div ref={setViewEl} className="relative overflow-hidden" data-epg-window-start={win.startHour} data-epg-window-hours={win.hours}>
            <div style={{ width: timelineWidthPx, transform: `translateX(${-win.startHour * pxPerHour}px)` }} className="relative">
              {/* Hour header (only the hours in view) */}
              <div className="relative z-10 h-11 border-b border-neutral-800 bg-neutral-950/95">
                {hourMarkers.filter((h) => h + 1 > win.startHour && h < win.endHour).map((h) => (
                  <div key={h} className="absolute top-0 h-full border-r border-neutral-800/60 px-3 pb-1 pt-3 text-xs font-mono text-neutral-400"
                    style={{ left: h * pxPerHour, width: pxPerHour }}>
                    {hourLabel(h)}
                  </div>
                ))}
              </div>

              {/* Channel rows with program blocks (only blocks in the window get DOM) */}
              {visible.map((channel) => {
                const g = grouped.get(channel.id);
                const isBlocks = !!g && g.mode !== 'programs';
                return (
                <div
                  key={channel.id}
                  className="relative border-b border-neutral-800/80"
                  style={{ height: rowH }}
                  {...(g ? {
                    role: 'group',
                    'aria-label': `${channel.name}, ${g.mode === 'programs' ? g.items.length : g.cells.length} ${g.mode === 'programs' ? 'tracks' : g.mode === 'radio' ? 'daily block' : 'hourly blocks'}`,
                    'data-music-row': channel.id,
                    'data-music-channel': channel.id,
                    'data-now-program-id': g!.liveItem?.program.id ?? '',
                  } : {})}
                >
                  {hourMarkers.filter((h) => h + 1 > win.startHour && h < win.endHour).map((h) => (
                    <div key={h} className="absolute top-0 h-full border-r border-neutral-800/40 pointer-events-none"
                      style={{ left: h * pxPerHour, width: pxPerHour }} />
                  ))}

                  {channel.programs.length === 0 ? (
                    <div className="absolute inset-y-0 flex items-center px-4 text-xs font-medium text-neutral-500 italic bg-neutral-900/30" style={{ left: win.startHour * pxPerHour, width: viewWidth }}>
                      {channel.sourceError ? `Unavailable — ${channel.sourceError}` : channel.sourceStatus === 'restricted' ? 'Restricted by Archive' : 'No programs available'}
                    </div>
                  ) : isBlocks ? (
                    g!.cells.filter((b) => intersects(b.startHour, b.endHour, win)).map((b) => (
                      <span key={b.id} className="contents">
                        <BlockCell channel={channel} block={b} nowHour={nowHour} pxPerHour={pxPerHour}
                          onOpen={(block, opener) => setDrawer({ channel, block, opener })} />
                      </span>
                    ))
                  ) : (
                    channel.programs.map((p) => withLocalHours(p)).filter((p) => p.sHour < 24 && p.eHour > 0)
                      .map(({ program, sHour, eHour }, idx) => ({ program, sHour, eHour, idx }))
                      .filter((p) => intersects(p.sHour, p.eHour, win))
                      .map(({ program, sHour, eHour, idx }) => {
                        const isLive = nowHour >= sHour && nowHour < eHour;
                        const clip = clipToWindow(sHour, eHour, win);
                        return (
                          <span key={`${program.id}-${idx}`} className="contents">
                            <EpgProgramBlock
                              program={program} channel={channel} guideId={guideId} idx={idx}
                              isLive={isLive} left={clip.s * pxPerHour} width={(clip.e - clip.s) * pxPerHour}
                              onSelectProgram={onSelectProgram}
                              tune={{ sHour, eHour, nowHour: currentHourFraction }}
                            />
                          </span>
                        );
                      }))}
                </div>
                );
              })}

              {/* Live "now" line — real current time */}
              {nowLeftPx !== null && (
                <div
                  className="pointer-events-none absolute top-0 z-20 w-px bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]"
                  data-now-hour={nowHour}
                  style={{ left: win.startHour * pxPerHour + nowLeftPx, height: 44 + visible.length * rowH }}
                >
                  <div className="absolute -left-1 -top-1 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-red-400/40" />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {drawer && (
        <TrackDrawer channel={drawer.channel} block={drawer.block} guideId={guideId} nowHour={nowHour}
          opener={drawer.opener} onClose={() => setDrawer(null)} onSelectProgram={onSelectProgram} />
      )}
      {hasMore && (
        <div ref={sentinelRef} className="border-t border-neutral-800 p-3 text-center text-xs text-neutral-500">
          Showing {visible.length} of {filtered.rows.length} channels — scroll for more
          <button type="button" onClick={() => setVisibleCount((n) => n + PAGE_ROWS)} className="ml-3 rounded border border-neutral-700 px-2 py-0.5 text-neutral-300 hover:bg-neutral-800 cursor-pointer">Load more</button>
        </div>
      )}
    </div>
  );
}

