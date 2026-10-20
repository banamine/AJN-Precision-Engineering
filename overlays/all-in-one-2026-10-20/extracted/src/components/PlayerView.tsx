import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PlayCircle, Heart } from "lucide-react";
import { RUSH_PROGRAM, resolveRushNext, upNextLabel, type RushNext } from "../utils/rushNext";
import { loadRushSettings, RUSH_SETTINGS_EVENT } from "../utils/rushSettings";
import MinimalPlayer from "../MinimalPlayer";
import { toPlayableSrc } from "../utils/playableSrc";
import { reportTelemetry } from "../telemetry";
import { AvSyncControls } from "./AvSyncControls";
import { FullShowStatus } from "./FullShowStatus";
import { getShowQueue, isQueuePart, peekNextPart, stepShowQueue, syncShowQueue } from "../utils/showQueue";
import { GUIDE_FALLBACK_ORDER, fullShowTargets, nextInLoop, pickAnotherItem, radioNext, targetKey, type PlayTarget } from "../utils/continuity";
import { loadAjnFeeds } from "../services/ajnFeeds";
import { buildRadioCatalog } from "../utils/ajnRadioCatalog";
import { pickLatestFullShows, type FeedItemLike } from "../utils/latestFullShows";
import { CaptionPanel } from "../news/captions/CaptionPanel";
import { AudioAsrTranscriptPanel } from "./AudioAsrTranscriptPanel";
import { bufferGaugeMetadata } from "../utils/bufferGauge";

/** Readable, stable id for a show title: "<channelId>/<title-slug>". Used in logs
 *  and telemetry so a failing playback can be found by name. */
/** Which item follows `np` in `programs`: the next clip of a segmented show, else the next program
 *  (wrapping to the first). One rule shared by auto-advance and the next-track preload. */
export type NextPick =
  | { kind: "segment"; cur: any; seg: any }
  | { kind: "program"; next: any; nextIndex: number };
export function pickNext(np: { programId?: string; assetId?: string; archivePath?: string; src?: string }, programs: any[]): NextPick | null {
  if (!programs.length) return null;
  const currentIndex = programs.findIndex((p: any) =>
    (np.programId && p.id === np.programId) ||
    (np.assetId && (p.assetId ?? p.metadata?.assetId) === np.assetId) ||
    (np.archivePath && p.archivePath === np.archivePath) ||
    p.mediaUrl === np.src,
  );
  const cur = currentIndex >= 0 ? programs[currentIndex] : null;
  const segs: any[] = Array.isArray(cur?.metadata?.segments) ? cur.metadata.segments : [];
  if (segs.length > 1) {
    const si = segs.findIndex((s) => (np.archivePath && s.archivePath === np.archivePath) || s.mediaUrl === np.src || s.archivePath === np.src);
    const seg = si >= 0 ? segs[si + 1] : null;
    if (seg) return { kind: "segment", cur, seg };
  }
  const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % programs.length;
  const next = programs[nextIndex];
  return next ? { kind: "program", next, nextIndex } : null;
}

export function titleIdOf(channelId: string | undefined, title: string | undefined): string {
  const slug = String(title ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return `${channelId || "none"}/${slug || "untitled"}`;
}

// Playlists often contain a few items Archive has restricted or removed; skip
// past them quickly, but give up after a long run so a dead channel stops.
const MAX_CONSECUTIVE_FAILURES = 20;
const SKIP_AFTER_ERROR_MS = 1500;
// After a long run of failures (offline?) keep trying, but slowly: playback is never left idle.
const SLOW_RETRY_MS = 30_000;

export function PlayerView({ nowPlaying, onSelectProgram, onProgress, onNavigate, isFavorite = false, onToggleFavorite }: any) {
  const failuresRef = useRef(0);
  const playerWrapRef = useRef<HTMLDivElement | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const skipTimerRef = useRef<number | null>(null);

  // 24/7 continuity: when a program ends (or fails), play the next program on the
  // same channel, wrapping to the first one. If the current program can't be
  // found in the refreshed schedule, start the channel from its first program.
  // Each play is a new nowPlaying object: that object is the playback instance.
  // Async advance work checks it is still current before acting, so Stop, a
  // manual pick, or a replay made meanwhile always wins over a late result.
  const latestRef = useRef(nowPlaying);
  latestRef.current = nowPlaying;
  const advancingForRef = useRef<unknown>(null);

  // Rush: work out what plays next once per play (and again if the preference
  // changes). The auto-advance and the Up Next line both read this one result.
  const [continueAcross, setContinueAcross] = useState(() => loadRushSettings().continueAcrossDates);
  useEffect(() => {
    const on = (e: Event) => setContinueAcross(Boolean((e as CustomEvent).detail?.continueAcrossDates));
    window.addEventListener(RUSH_SETTINGS_EVENT, on);
    return () => window.removeEventListener(RUSH_SETTINGS_EVENT, on);
  }, []);
  const rushPlanRef = useRef<{ instance: unknown; continueAcross: boolean; promise: Promise<RushNext>; ms?: number } | null>(null);
  const [upNext, setUpNext] = useState<RushNext | null>(null);
  const rushPlanFor = useCallback((instance: any): Promise<RushNext> => {
    const cur = rushPlanRef.current;
    if (cur && cur.instance === instance && cur.continueAcross === continueAcross) return cur.promise;
    const t0 = performance.now();
    const entry: { instance: unknown; continueAcross: boolean; promise: Promise<RushNext>; ms?: number } = { instance, continueAcross, promise: null as any };
    entry.promise = resolveRushNext(String(instance.programId), continueAcross, fetch, () => latestRef.current !== instance)
      .then((n) => { entry.ms = Math.round(performance.now() - t0); return n; });
    rushPlanRef.current = entry;
    return entry.promise;
  }, [continueAcross]);
  useEffect(() => {
    setUpNext(null);
    if (!nowPlaying || nowPlaying.channelId !== "rush-vod" || !RUSH_PROGRAM.test(String(nowPlaying.programId ?? ""))) return;
    let live = true;
    void rushPlanFor(nowPlaying).then((n) => { if (live) setUpNext(n); });
    return () => { live = false; };
  }, [nowPlaying, rushPlanFor]);

  // The channel's program list, fetched once per playing item and shared by the next-track preload
  // and the end-of-track advance (the schedule payload is large; never fetch it twice per item).
  const scheduleRef = useRef<{ instance: unknown; promise: Promise<any[]> } | null>(null);
  const schedulePrograms = useCallback((instance: any): Promise<any[]> => {
    const cur = scheduleRef.current;
    if (cur && cur.instance === instance) return cur.promise;
    const guideId = instance.guideId || "cable-tv";
    const promise = (async () => {
      // Ask for this channel only: the whole guide can be tens of MB and must never be what stops the next item from playing.
      const chan = instance.channelId ? `&channel=${encodeURIComponent(instance.channelId)}` : "";
      const res = await fetch(`/api/schedule?guide=${encodeURIComponent(guideId)}${chan}`);
      if (!res.ok) throw new Error(`schedule HTTP ${res.status}`);
      const data = await res.json();
      const channels = Array.isArray(data.channels) ? data.channels : [];
      const channel = channels.find((c: any) => c.id === instance.channelId);
      return Array.isArray(channel?.programs) ? channel.programs : [];
    })();
    // A failed lookup is not cached: the advance retries it.
    promise.catch(() => { if (scheduleRef.current?.promise === promise) scheduleRef.current = null; });
    scheduleRef.current = { instance, promise };
    return promise;
  }, []);
  /** Previous program of the channel (wraps); Rush calendar items have no neighbour. */
  const goPrev = useCallback(async () => {
    const instance = latestRef.current;
    if (instance && isQueuePart(instance.programId)) {
      const q = getShowQueue()!; const prevPart = stepShowQueue(-1);
      if (prevPart) onSelectProgram(prevPart.src, prevPart.title, `Full show · ${q.label}`, prevPart.mediaType, "ajn-radio", "ajn-radio", prevPart.programId);
      return;
    }
    if (!instance || (instance.channelId === "rush-vod" && RUSH_PROGRAM.test(String(instance.programId ?? "")))) return;
    const programs = await schedulePrograms(instance).catch(() => [] as any[]);
    if (latestRef.current !== instance || !programs.length) return;
    const i = programs.findIndex((p: any) => (instance.programId && p.id === instance.programId) || (instance.archivePath && p.archivePath === instance.archivePath) || p.mediaUrl === instance.src);
    const prev = programs[i <= 0 ? programs.length - 1 : i - 1];
    if (!prev) return;
    onSelectProgram(prev.archivePath || prev.mediaUrl, prev.title, prev.description, prev.mediaType, prev.channelId, prev.guideId, prev.id,
      prev.sourceId ?? prev.metadata?.sourceId, prev.assetId ?? prev.metadata?.assetId);
  }, [onSelectProgram, schedulePrograms]);
  /** The playable URL + media type of what follows, or null (Rush, unknown, lookup failed). */
  const resolveNext = useCallback(async (): Promise<{ src: string; mediaType: string; programId?: string; guideId?: string; channelId?: string } | null> => {
    const instance = latestRef.current;
    if (instance && isQueuePart(instance.programId)) { const n = peekNextPart(); return n ? { src: toPlayableSrc(n.src), mediaType: n.mediaType } : null; }
    if (!instance || (instance.channelId === "rush-vod" && RUSH_PROGRAM.test(String(instance.programId ?? "")))) return null;
    try {
      const programs = await schedulePrograms(instance);
      if (latestRef.current !== instance) return null;
      const pick = pickNext(instance, programs);
      if (!pick) return null;
      const item = pick.kind === "segment" ? pick.seg : pick.next;
       const parent = pick.kind === "segment" ? pick.cur : pick.next;
      const ref = String(item.archivePath || item.mediaUrl || "").trim();
      if (!ref) return null;
       return {
         src: toPlayableSrc(ref),
         mediaType: String(parent.mediaType ?? ""),
         programId: String(item.id ?? "") || undefined,
         guideId: String(parent.guideId ?? instance.guideId ?? "") || undefined,
         channelId: String(parent.channelId ?? instance.channelId ?? "") || undefined,
       };
    } catch { return null; }
  }, [schedulePrograms]);

  // Continuity bookkeeping. `failedRef` = items that failed since something last played (never picked again in this chain).
  const failedRef = useRef<Set<string>>(new Set());
  const fallbackLoopRef = useRef<PlayTarget[] | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  /** Set while the AJN Full Shows fallback is what is playing: its end loops the fallback instead of walking the Radio list. A manual pick clears it. */
  const fallbackKeyRef = useRef<string | null>(null);

  const playTarget = useCallback((instance: any, t: PlayTarget, event: string): true => {
    if (event === "playback.fallback_full_shows" || event === "playback.fallback_loop") fallbackKeyRef.current = targetKey(t);
    reportTelemetry({ event, guideId: t.guideId ?? null, channelId: t.channelId ?? null, programId: t.programId ?? null,
      titleId: titleIdOf(t.channelId, t.title), sourceId: t.sourceId ?? null, assetId: t.assetId ?? null, mediaPath: t.src });
    // A one-item loop replays the same file: remount the player so it restarts instead of staying ended.
    if (t.src === instance.src || t.src === instance.archivePath) setRetryNonce((n) => n + 1);
    onSelectProgram(t.src, t.title, t.description, t.mediaType, t.channelId, t.guideId, t.programId, t.sourceId, t.assetId);
    return true;
  }, [onSelectProgram]);

  /** Tier 2: another playable video/audio item from any guide (smallest guides first). Skips the current and failed items. */
  const findOtherItem = useCallback(async (instance: any, stale: () => boolean): Promise<PlayTarget | null> => {
    for (const guideId of GUIDE_FALLBACK_ORDER) {
      if (stale()) return null;
      try {
        const ctl = new AbortController(); const timer = window.setTimeout(() => ctl.abort(), 25_000);
        const res = await fetch(`/api/schedule?guide=${encodeURIComponent(guideId)}`, { signal: ctl.signal }).finally(() => window.clearTimeout(timer));
        if (!res.ok) continue;
        const data = await res.json();
        const t = pickAnotherItem([{ guideId, channels: Array.isArray(data.channels) ? data.channels : [] }], instance, failedRef.current, Date.now());
        if (t) return t;
      } catch { /* this guide is unavailable: try the next one */ }
    }
    return null;
  }, []);

  /** Tier 3: AJN Full Shows audio (newest whole show of each AJN show). Loaded once, then looped. */
  const loadFullShowsLoop = useCallback(async (): Promise<PlayTarget[]> => {
    if (fallbackLoopRef.current?.length) return fallbackLoopRef.current;
    const byFeed: Record<string, FeedItemLike[]> = {};
    await Promise.allSettled((["Alex", "WarRoom"] as const).map(async (id) => {
      const r = await fetch(`/api/ajn/resources/${id}`);
      if (!r.ok) throw new Error(`${id} HTTP ${r.status}`);
      byFeed[id] = ((await r.json()).items ?? []) as FeedItemLike[];
    }));
    const loop = fullShowTargets(pickLatestFullShows(byFeed));
    if (loop.length) fallbackLoopRef.current = loop;
    return loop;
  }, []);

  /** Tiers 2-4. Returns true when something was started (or the instance was superseded). */
  const continueElsewhere = useCallback(async (instance: any, stale: () => boolean): Promise<boolean> => {
    const failed = failedRef.current; const curKey = targetKey(instance);
    // Already inside the Full Shows loop: stay in it (and wrap around).
    const loop0 = fallbackLoopRef.current;
    if (loop0?.some((t) => targetKey(t) === curKey)) {
      const t = nextInLoop(loop0, curKey, failed);
      if (t) return playTarget(instance, t, "playback.fallback_loop");
    }
    const other = await findOtherItem(instance, stale);
    if (stale()) return true;
    if (other) return playTarget(instance, other, "playback.continue_other");
    let loop: PlayTarget[] = [];
    try { loop = await loadFullShowsLoop(); } catch { /* handled below */ }
    if (stale()) return true;
    const t = nextInLoop(loop, curKey, failed);
    if (t) return playTarget(instance, t, "playback.fallback_full_shows");
    return false;
  }, [findOtherItem, loadFullShowsLoop, playTarget]);

  /** Tier 1: what follows in the current list. true = started or superseded; false = nothing follows (fall through to tiers 2-4). */
  const nextInList = useCallback(async (instance: any, reason: "ended" | "error", stale: () => boolean): Promise<boolean> => {
    // A Full Show plays its real parts in order (and reports a part that fails) before any channel-schedule logic.
    if (isQueuePart(instance.programId)) {
      const q = getShowQueue()!;
      const nextPart = stepShowQueue(1, reason === "error");
      if (nextPart) { onSelectProgram(nextPart.src, nextPart.title, `Full show · ${q.label}`, nextPart.mediaType, "ajn-radio", "ajn-radio", nextPart.programId); return true; }
      return false; // last part played: the rest of the chain decides
    }

    // AJN Radio items have no schedule: the next entry of the Radio list (wrapping).
    if (instance.channelId === "ajn-radio" || instance.channelId === "ajn-exclusive") {
      try {
        const { items } = await loadAjnFeeds(new AbortController().signal);
        const cat = buildRadioCatalog(items.filter((i) => i.url).map((i) => ({ id: i.id, title: i.title, url: i.url!, mediaType: i.mediaType as "audio" | "video", publishedAt: i.publishedAt })));
        const list = [...cat.radio, ...cat.exclusive];
        const t = radioNext(list, instance.programId, instance.mediaType === "video", failedRef.current);
        if (stale()) return true;
        if (t) return playTarget(instance, t, "playback.advance");
      } catch { /* feeds unavailable: fall through */ }
      return false;
    }

    // Rush picked from the calendar: the next hour, then (if the preference is on)
    // the next available date. Same computation as the Up Next line.
    if (instance.channelId === "rush-vod" && RUSH_PROGRAM.test(String(instance.programId ?? ""))) {
      const n = await rushPlanFor(instance);
      if (stale()) return true;
      const base = { guideId: instance.guideId ?? null, channelId: "rush-vod", programId: instance.programId ?? null,
        titleId: titleIdOf("rush-vod", instance.title), sourceId: null, assetId: null };
      if (n.kind === "failed") {
        reportTelemetry({ ...base, event: "rush.auto_advance_failed", mediaPath: null, httpStatus: n.httpStatus ?? null,
          failureReason: n.failureReason, lookupDurationMs: n.lookupDurationMs });
        return false;
      }
      if (n.kind !== "next") { reportTelemetry({ ...base, event: `rush.auto_advance_${n.kind}`, mediaPath: null }); return false; }
      reportTelemetry({ ...base, event: n.item.date === RUSH_PROGRAM.exec(instance.programId)![1] ? "rush.auto_advance" : "rush.auto_advance_next_date",
        mediaPath: n.item.archivePath, lookupDurationMs: rushPlanRef.current?.ms ?? null });
      onSelectProgram(n.item.archivePath, n.item.title, n.item.subtitle, "audio", "rush-vod", "audio-podcasts", n.item.programId);
      return true;
    }

    if (!instance.channelId) return false; // a single item with no list (e.g. opened from History): tiers 2-4
    const programs = await schedulePrograms(instance).catch(() => [] as any[]);
    if (stale()) return true;
    if (programs.length === 0) return false;

    const pick = pickNext(instance, programs);
    if (!pick) return false;
    if (pick.kind === "segment") {
      const { cur, seg } = pick;
      reportTelemetry({ event: reason === "error" ? "playback.skip_failed" : "playback.segment", guideId: cur.guideId ?? null, channelId: cur.channelId ?? null,
        programId: cur.id ?? null, titleId: titleIdOf(cur.channelId, cur.title), sourceId: cur.sourceId ?? null, assetId: cur.assetId ?? null, mediaPath: seg.archivePath ?? seg.mediaUrl ?? null });
      onSelectProgram(seg.archivePath || seg.mediaUrl, cur.title, cur.description, cur.mediaType,
        cur.channelId, cur.guideId, cur.id, cur.sourceId ?? cur.metadata?.sourceId, cur.assetId ?? cur.metadata?.assetId, undefined, bufferGaugeMetadata(cur.metadata));
      return true;
    }
    const { next, nextIndex } = pick;
    const sourceId = next.sourceId ?? next.metadata?.sourceId;
    const assetId = next.assetId ?? next.metadata?.assetId;
    if (!(next.archivePath || next.mediaUrl)) return false;
    reportTelemetry({
      event: reason === "error" ? "playback.skip_failed" : nextIndex === 0 ? "playback.loop" : "playback.advance",
      guideId: next.guideId ?? null,
      channelId: next.channelId ?? null,
      programId: next.id ?? null,
      titleId: titleIdOf(next.channelId, next.title),
      sourceId: sourceId ?? null,
      assetId: assetId ?? null,
      mediaPath: (next.archivePath || next.mediaUrl) ?? null,
    });
    onSelectProgram(next.archivePath || next.mediaUrl, next.title, next.description, next.mediaType,
      next.channelId, next.guideId, next.id, sourceId, assetId, undefined, bufferGaugeMetadata(next.metadata));
    return true;
  }, [onSelectProgram, playTarget, rushPlanFor, schedulePrograms]);

  /** Never idle: 1) next in the current list, 2) another item in the app, 3) AJN Full Shows audio, 4) loop; if even that
   *  cannot start (offline), retry slowly instead of stopping. One transition per playback instance. */
  const advance = useCallback(async (reason: "ended" | "error") => {
    const instance = nowPlaying;
    if (!instance || advancingForRef.current === instance) return;
    advancingForRef.current = instance;
    const stale = () => latestRef.current !== instance;
    if (reason === "error") failedRef.current.add(targetKey(instance));
    const inFallback = fallbackKeyRef.current !== null && fallbackKeyRef.current === targetKey(instance);
    if (!inFallback && await nextInList(instance, reason, stale).catch(() => false)) return;
    if (stale()) return;
    if (await continueElsewhere(instance, stale).catch(() => false)) return;
    if (stale()) return;
    reportTelemetry({ event: "playback.continuity_exhausted", guideId: instance.guideId ?? null, channelId: instance.channelId ?? null, programId: instance.programId ?? null,
      titleId: titleIdOf(instance.channelId, instance.title), sourceId: null, assetId: null, mediaPath: instance.archivePath ?? instance.src ?? null });
    // Visible, honest, and not final: try again shortly (cleared when something else starts playing).
    retryTimerRef.current = window.setTimeout(() => {
      if (latestRef.current !== instance) return;
      failedRef.current.clear(); advancingForRef.current = null; void advance(reason);
    }, SLOW_RETRY_MS);
  }, [nowPlaying, nextInList, continueElsewhere]);

  // A manual pick (anything other than what the fallback started) ends fallback mode.
  useEffect(() => { if (fallbackKeyRef.current && nowPlaying && targetKey(nowPlaying) !== fallbackKeyRef.current) fallbackKeyRef.current = null; }, [nowPlaying]);
  // Anything that is not a part of the active Full Show ends it; picking another part moves the position.
  useEffect(() => { syncShowQueue(nowPlaying?.programId); }, [nowPlaying?.programId]);
  useEffect(() => () => { if (skipTimerRef.current) window.clearTimeout(skipTimerRef.current); if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current); }, [nowPlaying]);

  const meta = useMemo(() => nowPlaying ? ({
    titleId: titleIdOf(nowPlaying.channelId, nowPlaying.title),
    guideId: nowPlaying.guideId ?? "unknown",
    channelId: nowPlaying.channelId ?? "unknown",
    programId: nowPlaying.programId ?? "unknown",
    sourceId: nowPlaying.sourceId ?? "unknown",
    assetId: nowPlaying.assetId ?? "unknown",
    path: nowPlaying.archivePath ?? nowPlaying.src,
  }) : null, [nowPlaying]);

  const onError = useCallback((err: MediaError | null) => {
    console.error("[AJN PLAYBACK] error", meta, err);
    failuresRef.current += 1;
    // Skip a broken item so the channel keeps playing, but stop after a run of
    // failures instead of hammering the source.
    // Every item advances on failure (not only channel items); after a long run of failures, keep going slowly.
    if (!nowPlaying) return;
    const delay = failuresRef.current > MAX_CONSECUTIVE_FAILURES ? SLOW_RETRY_MS : SKIP_AFTER_ERROR_MS;
    skipTimerRef.current = window.setTimeout(() => void advance("error"), delay);
  }, [advance, meta, nowPlaying]);

  if (!nowPlaying) {
    return (
      <div data-testid="player-empty" className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-xl border border-neutral-800 bg-neutral-900/60 p-8 text-center">
        <PlayCircle className="h-10 w-10 text-sky-400" aria-hidden="true" />
        <div>
          <h2 className="text-lg font-semibold text-neutral-50">Nothing playing yet</h2>
          <p className="mt-1 text-sm text-neutral-400">Playback starts when you pick a programme. Open today's list to see what is on and tap anything to watch or listen.</p>
        </div>
        <div className="flex w-full flex-col gap-2">
          <button type="button" onClick={() => onNavigate?.("today")} data-testid="player-open-guide" className="w-full rounded-lg bg-sky-500 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300">Open Guide</button>
          <button type="button" onClick={() => onNavigate?.("tv-guide")} className="w-full rounded-lg border border-neutral-700 px-4 py-2.5 text-sm text-neutral-200 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">Full time grid</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <FullShowStatus />
      {onToggleFavorite && (
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate text-sm font-semibold text-neutral-100" data-testid="player-title">{nowPlaying.title}</span>
          <button type="button" data-testid="player-heart" aria-pressed={isFavorite} onClick={onToggleFavorite}
            aria-label={isFavorite ? `Remove ${nowPlaying.title} from favorites` : `Add ${nowPlaying.title} to favorites`}
            title={isFavorite ? "Remove from Favorites" : "Add to Favorites"}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 ${isFavorite ? "border-rose-500/60 bg-rose-500/10 text-rose-300" : "border-neutral-700 text-neutral-300 hover:border-rose-500/50 hover:text-rose-300"}`}>
            <Heart className={`h-4 w-4 ${isFavorite ? "fill-rose-500 text-rose-500" : ""}`} aria-hidden="true" />
            {isFavorite ? "Favorited" : "Favorite"}
          </button>
        </div>
      )}
      <div ref={playerWrapRef}>
      <Fragment key={retryNonce}>
      <MinimalPlayer
        onRetry={() => { failuresRef.current = 0; setRetryNonce((n) => n + 1); }}
        onBackToGuide={() => onNavigate?.("tv-guide")}
        src={nowPlaying.src}
        title={nowPlaying.title}
        mediaType={nowPlaying.mediaType ?? "video"}
        nowPlaying={nowPlaying}
        onProgramEnded={() => void advance("ended")}
        resolveNext={resolveNext}
        onPrev={nowPlaying.channelId ? () => void goPrev() : undefined}
        onNext={() => void advance("ended")}
        onPlayEvent={() => { failuresRef.current = 0; failedRef.current.clear(); console.log("[AJN PLAYBACK] play", meta); }}
        onPauseEvent={() => console.log("[AJN PLAYBACK] pause", meta)}
        onErrorEvent={onError}
        autoplayBlockedLabel={nowPlaying.channelId === "rush-vod" ? "Next hour ready — tap Play" : undefined}
        onProgressEvent={(positionSeconds: number) => {
          const itemId = nowPlaying.assetId || nowPlaying.programId || nowPlaying.sourceId || nowPlaying.archivePath || nowPlaying.src;
          onProgress?.(itemId, positionSeconds);
        }}
      />
      </Fragment>
      </div>
      <CaptionPanel nowPlaying={nowPlaying} getVideo={() => playerWrapRef.current?.querySelector("video") ?? null} />
      {nowPlaying.channelId === "archive-infowars-radio" && <AudioAsrTranscriptPanel identifier={nowPlaying.sourceId} getAudio={() => playerWrapRef.current?.querySelector("audio") ?? null} />}
      <AvSyncControls nowPlaying={nowPlaying} onPlay={onSelectProgram} onNavigate={onNavigate} variant="compact" />
      {nowPlaying.channelId === "rush-vod" && upNextLabel(upNext, RUSH_PROGRAM.exec(String(nowPlaying.programId ?? ""))?.[1]) && (
        <p className="text-xs text-neutral-400" aria-live="polite" data-testid="rush-up-next">
          {upNextLabel(upNext, RUSH_PROGRAM.exec(String(nowPlaying.programId ?? ""))?.[1])}
        </p>
      )}
      {(import.meta as any).env?.DEV && (
        <details aria-label="Developer playback diagnostics" className="rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs font-mono">
          <summary className="cursor-pointer text-neutral-400">Developer playback identity</summary>
          <pre className="mt-2 text-neutral-300">{JSON.stringify(meta, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}
