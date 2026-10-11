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

export function PlayerView({ nowPlaying, onSelectProgram, onProgress, onNavigate, isFavorite = false, onToggleFavorite }: any) {
  const failuresRef = useRef(0);
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
      const res = await fetch(`/api/schedule?guide=${encodeURIComponent(guideId)}`);
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
  const resolveNext = useCallback(async (): Promise<{ src: string; mediaType: string; programId?: string } | null> => {
    const instance = latestRef.current;
    if (instance && isQueuePart(instance.programId)) { const n = peekNextPart(); return n ? { src: toPlayableSrc(n.src), mediaType: n.mediaType } : null; }
    if (!instance || (instance.channelId === "rush-vod" && RUSH_PROGRAM.test(String(instance.programId ?? "")))) return null;
    try {
      const programs = await schedulePrograms(instance);
      if (latestRef.current !== instance) return null;
      const pick = pickNext(instance, programs);
      if (!pick) return null;
      const item = pick.kind === "segment" ? pick.seg : pick.next;
      const ref = String(item.archivePath || item.mediaUrl || "").trim();
      if (!ref) return null;
      return { src: toPlayableSrc(ref), mediaType: String((pick.kind === "segment" ? pick.cur : pick.next).mediaType ?? ""), programId: String((item as { id?: string }).id ?? "") || undefined };
    } catch { return null; }
  }, [schedulePrograms]);

  const advance = useCallback(async (reason: "ended" | "error") => {
    const instance = nowPlaying;
    if (!instance || advancingForRef.current === instance) return; // one transition per instance
    advancingForRef.current = instance;
    const stale = () => latestRef.current !== instance;

    // A Full Show plays its real parts in order (and reports a part that fails) before any channel-schedule logic.
    if (isQueuePart(instance.programId)) {
      const q = getShowQueue()!;
      const nextPart = stepShowQueue(1, reason === "error");
      if (nextPart) onSelectProgram(nextPart.src, nextPart.title, `Full show · ${q.label}`, nextPart.mediaType, "ajn-radio", "ajn-radio", nextPart.programId);
      return;
    }

    // Rush picked from the calendar: the next hour, then (if the preference is on)
    // the next available date. Same computation as the Up Next line.
    if (instance.channelId === "rush-vod" && RUSH_PROGRAM.test(String(instance.programId ?? ""))) {
      const n = await rushPlanFor(instance);
      if (stale()) return;
      const base = { guideId: instance.guideId ?? null, channelId: "rush-vod", programId: instance.programId ?? null,
        titleId: titleIdOf("rush-vod", instance.title), sourceId: null, assetId: null };
      if (n.kind === "failed") {
        reportTelemetry({ ...base, event: "rush.auto_advance_failed", mediaPath: null, httpStatus: n.httpStatus ?? null,
          failureReason: n.failureReason, lookupDurationMs: n.lookupDurationMs });
        return;
      }
      if (n.kind !== "next") { reportTelemetry({ ...base, event: `rush.auto_advance_${n.kind}`, mediaPath: null }); return; }
      reportTelemetry({ ...base, event: n.item.date === RUSH_PROGRAM.exec(instance.programId)![1] ? "rush.auto_advance" : "rush.auto_advance_next_date",
        mediaPath: n.item.archivePath, lookupDurationMs: rushPlanRef.current?.ms ?? null });
      onSelectProgram(n.item.archivePath, n.item.title, n.item.subtitle, "audio", "rush-vod", "audio-podcasts", n.item.programId);
      return;
    }

    const programs = await schedulePrograms(instance).catch(() => [] as any[]);
    if (stale() || programs.length === 0) return;

    const pick = pickNext(instance, programs);
    if (!pick) return;
    if (pick.kind === "segment") {
      const { cur, seg } = pick;
      reportTelemetry({ event: reason === "error" ? "playback.skip_failed" : "playback.segment", guideId: cur.guideId ?? null, channelId: cur.channelId ?? null,
        programId: cur.id ?? null, titleId: titleIdOf(cur.channelId, cur.title), sourceId: cur.sourceId ?? null, assetId: cur.assetId ?? null, mediaPath: seg.archivePath ?? seg.mediaUrl ?? null });
      onSelectProgram(seg.archivePath || seg.mediaUrl, cur.title, cur.description, cur.mediaType,
        cur.channelId, cur.guideId, cur.id, cur.sourceId ?? cur.metadata?.sourceId, cur.assetId ?? cur.metadata?.assetId);
      return;
    }
    const { next, nextIndex } = pick;
    const sourceId = next.sourceId ?? next.metadata?.sourceId;
    const assetId = next.assetId ?? next.metadata?.assetId;

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
      next.channelId, next.guideId, next.id, sourceId, assetId);
  }, [nowPlaying, onSelectProgram, rushPlanFor, schedulePrograms]);

  // Anything that is not a part of the active Full Show ends it; picking another part moves the position.
  useEffect(() => { syncShowQueue(nowPlaying?.programId); }, [nowPlaying?.programId]);
  useEffect(() => () => { if (skipTimerRef.current) window.clearTimeout(skipTimerRef.current); }, [nowPlaying?.src]);

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
    if (!nowPlaying?.channelId || failuresRef.current > MAX_CONSECUTIVE_FAILURES) return;
    skipTimerRef.current = window.setTimeout(() => void advance("error"), SKIP_AFTER_ERROR_MS);
  }, [advance, meta, nowPlaying?.channelId]);

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
        onNext={nowPlaying.channelId ? () => void advance("ended") : undefined}
        onPlayEvent={() => { failuresRef.current = 0; console.log("[AJN PLAYBACK] play", meta); }}
        onPauseEvent={() => console.log("[AJN PLAYBACK] pause", meta)}
        onErrorEvent={onError}
        autoplayBlockedLabel={nowPlaying.channelId === "rush-vod" ? "Next hour ready — tap Play" : undefined}
        onProgressEvent={(positionSeconds: number) => {
          const itemId = nowPlaying.assetId || nowPlaying.programId || nowPlaying.sourceId || nowPlaying.archivePath || nowPlaying.src;
          onProgress?.(itemId, positionSeconds);
        }}
      />
      </Fragment>
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
