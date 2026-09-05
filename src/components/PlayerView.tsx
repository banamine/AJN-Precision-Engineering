import { useCallback, useMemo } from "react";
import MinimalPlayer from "../MinimalPlayer";
import { reportTelemetry } from "../telemetry";

export function PlayerView({ nowPlaying, onSelectProgram, onNavigate }: any) {
  const handleProgramEnded = useCallback(async () => {
    const guideId = nowPlaying?.guideId || "cable-tv";
    const res = await fetch(`/api/schedule?guide=${encodeURIComponent(guideId)}`);
    if (!res.ok) return;
    const data = await res.json();
    const channels = Array.isArray(data.channels) ? data.channels : [];
    const channel = channels.find((c: any) => c.id === nowPlaying?.channelId);
    const programs = Array.isArray(channel?.programs) ? channel.programs : [];
    const index = programs.findIndex((p: any) => p.mediaUrl === nowPlaying?.src || p.archivePath === nowPlaying?.src || (nowPlaying.archivePath && p.archivePath === nowPlaying.archivePath));
    const next = programs[(index + 1) % programs.length];
    if (!next) return;

    reportTelemetry({
      event: index + 1 >= programs.length ? "playback.loop" : "playback.advance",
      guideId: next.guideId ?? null,
      channelId: next.channelId ?? null,
      programId: next.id ?? null,
      sourceId: next.metadata?.sourceId ?? null,
      assetId: next.metadata?.assetId ?? null,
      mediaPath: (next.archivePath || next.mediaUrl) ?? null,
    });
    
    onSelectProgram(
      next.archivePath || next.mediaUrl,
      next.title,
      next.description,
      next.mediaType,
      next.channelId,
      next.guideId,
      next.id,
      next.metadata?.sourceId,
      next.metadata?.assetId
    );
  }, [nowPlaying, onSelectProgram]);

  const meta = useMemo(() => nowPlaying ? ({
    programId: nowPlaying.programId ?? "unknown",
    sourceId: nowPlaying.sourceId ?? "unknown",
    assetId: nowPlaying.assetId ?? "unknown",
  }) : null, [nowPlaying]);

  if (!nowPlaying) return <div className="p-6">No media selected.</div>;

  return (
    <div className="space-y-4">
      <MinimalPlayer
        src={nowPlaying.src}
        title={nowPlaying.title}
        nowPlaying={nowPlaying}
        onProgramEnded={handleProgramEnded}
        onPlayEvent={() => console.log("[AJN PLAYBACK] play", meta)}
        onPauseEvent={() => console.log("[AJN PLAYBACK] pause", meta)}
        onErrorEvent={(err) => console.error("[AJN PLAYBACK] error", meta, err)}
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
