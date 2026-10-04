import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RUSH_PROGRAM, resolveRushNext, upNextLabel, type RushNext } from "../utils/rushNext";
import { loadRushSettings, RUSH_SETTINGS_EVENT } from "../utils/rushSettings";
import MinimalPlayer from "../MinimalPlayer";
import { reportTelemetry } from "../telemetry";
import { AvSyncControls } from "./AvSyncControls";

/** Readable, stable id for a show title: "<channelId>/<title-slug>". Used in logs
 *  and telemetry so a failing playback can be found by name. */
export function titleIdOf(channelId: string | undefined, title: string | undefined): string {
  const slug = String(title ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return `${channelId || "none"}/${slug || "untitled"}`;
}

// Playlists often contain a few items Archive has restricted or removed; skip
// past them quickly, but give up after a long run so a dead channel stops.
const MAX_CONSECUTIVE_FAILURES = 20;
const SKIP_AFTER_ERROR_MS = 1500;

export function PlayerView({ nowPlaying, onSelectProgram, onProgress, onNavigate }: any) {
  const failuresRef = useRef(0);
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

  const advance = useCallback(async (reason: "ended" | "error") => {
    const instance = nowPlaying;
    if (!instance || advancingForRef.current === instance) return; // one transition per instance
    advancingForRef.current = instance;
    const stale = () => latestRef.current !== instance;

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

    const guideId = instance.guideId || "cable-tv";
    const res = await fetch(`/api/schedule?guide=${encodeURIComponent(guideId)}`);
    if (!res.ok || stale()) return;
    const data = await res.json();
    if (stale()) return;
    const channels = Array.isArray(data.channels) ? data.channels : [];
    const channel = channels.find((c: any) => c.id === nowPlaying?.channelId);
    const programs = Array.isArray(channel?.programs) ? channel.programs : [];
    if (programs.length === 0) return;

    const currentIndex = programs.findIndex((p: any) =>
      (nowPlaying?.programId && p.id === nowPlaying.programId) ||
      (nowPlaying?.assetId && (p.assetId ?? p.metadata?.assetId) === nowPlaying.assetId) ||
      (nowPlaying?.archivePath && p.archivePath === nowPlaying.archivePath) ||
      p.mediaUrl === nowPlaying?.src,
    );
    // Clip-segmented show (TV News): play the next clip of the same show first.
    const cur = currentIndex >= 0 ? programs[currentIndex] : null;
    const segs: any[] = Array.isArray(cur?.metadata?.segments) ? cur.metadata.segments : [];
    if (segs.length > 1) {
      const si = segs.findIndex((s) => (nowPlaying?.archivePath && s.archivePath === nowPlaying.archivePath) || s.mediaUrl === nowPlaying?.src || s.archivePath === nowPlaying?.src);
      const seg = si >= 0 ? segs[si + 1] : null;
      if (seg) {
        reportTelemetry({ event: reason === "error" ? "playback.skip_failed" : "playback.segment", guideId: cur.guideId ?? null, channelId: cur.channelId ?? null,
          programId: cur.id ?? null, titleId: titleIdOf(cur.channelId, cur.title), sourceId: cur.sourceId ?? null, assetId: cur.assetId ?? null, mediaPath: seg.archivePath ?? seg.mediaUrl ?? null });
        onSelectProgram(seg.archivePath || seg.mediaUrl, cur.title, cur.description, cur.mediaType,
          cur.channelId, cur.guideId, cur.id, cur.sourceId ?? cur.metadata?.sourceId, cur.assetId ?? cur.metadata?.assetId);
        return;
      }
    }
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % programs.length;
    const next = programs[nextIndex];
    if (!next) return;
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
  }, [nowPlaying, onSelectProgram, rushPlanFor]);

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

  if (!nowPlaying) return <div className="p-6">No media selected.</div>;

  return (
    <div className="space-y-4">
      <MinimalPlayer
        src={nowPlaying.src}
        title={nowPlaying.title}
        mediaType={nowPlaying.mediaType ?? "video"}
        nowPlaying={nowPlaying}
        onProgramEnded={() => void advance("ended")}
        onPlayEvent={() => { failuresRef.current = 0; console.log("[AJN PLAYBACK] play", meta); }}
        onPauseEvent={() => console.log("[AJN PLAYBACK] pause", meta)}
        onErrorEvent={onError}
        autoplayBlockedLabel={nowPlaying.channelId === "rush-vod" ? "Next hour ready — tap Play" : undefined}
        onProgressEvent={(positionSeconds: number) => {
          const itemId = nowPlaying.assetId || nowPlaying.programId || nowPlaying.sourceId || nowPlaying.archivePath || nowPlaying.src;
          onProgress?.(itemId, positionSeconds);
        }}
      />
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
