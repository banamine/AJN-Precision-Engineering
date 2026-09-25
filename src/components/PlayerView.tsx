import { useCallback, useEffect, useMemo, useRef } from "react";
import MinimalPlayer from "../MinimalPlayer";
import { reportTelemetry } from "../telemetry";

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

export function PlayerView({ nowPlaying, onSelectProgram, onProgress }: any) {
  const failuresRef = useRef(0);
  const skipTimerRef = useRef<number | null>(null);

  // 24/7 continuity: when a program ends (or fails), play the next program on the
  // same channel, wrapping to the first one. If the current program can't be
  // found in the refreshed schedule, start the channel from its first program.
  const advance = useCallback(async (reason: "ended" | "error") => {
    const guideId = nowPlaying?.guideId || "cable-tv";
    const res = await fetch(`/api/schedule?guide=${encodeURIComponent(guideId)}`);
    if (!res.ok) return;
    const data = await res.json();
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
  }, [nowPlaying, onSelectProgram]);

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
        onProgressEvent={(positionSeconds: number) => {
          const itemId = nowPlaying.assetId || nowPlaying.programId || nowPlaying.sourceId || nowPlaying.archivePath || nowPlaying.src;
          onProgress?.(itemId, positionSeconds);
        }}
      />
      {(import.meta as any).env?.DEV && (
        <details aria-label="Developer playback diagnostics" className="rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs font-mono">
          <summary className="cursor-pointer text-neutral-400">Developer playback identity</summary>
          <pre className="mt-2 text-neutral-300">{JSON.stringify(meta, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}
