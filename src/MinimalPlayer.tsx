import { useCallback, useEffect, useRef, useState } from "react";
import { reportTelemetry } from "./telemetry";
import { NowPlayingMedia } from "./types";
import { Play, Pause, Volume2, Volume1, VolumeX, Maximize, Minimize, RotateCcw, RotateCw, Tv, CheckCircle2 } from "lucide-react";
import { useAudioNormalization } from "./use-audio-normalization";
import { useSignalDiagnostics } from "./use-signal-diagnostics";

interface MinimalPlayerProps {
  src: string;
  title?: string;
  onProgramEnded?: () => void;
  nowPlaying?: NowPlayingMedia;
  onPlayEvent?: () => void;
  onPauseEvent?: () => void;
  onErrorEvent?: (err: MediaError | null) => void;
}

const TV_NEWS_SLICE_SEC = 300;
const TV_NEWS_TOTAL_SEC = 3600;

export default function MinimalPlayer({ src, title, onProgramEnded, nowPlaying, onPlayEvent, onPauseEvent, onErrorEvent }: MinimalPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [statusText, setStatusText] = useState("Loading…");
  const [activeSrc, setActiveSrc] = useState(src);
  const [archiveFallbackUsed, setArchiveFallbackUsed] = useState(false);

  const isArchiveProxy = activeSrc.startsWith("/api/archive/proxy?path=");

  // Keep the normal audio bridge. The player itself stays same-origin for
  // proxied Archive media and does not opt the <video> element into CORS.
  useAudioNormalization(videoRef, "video", activeSrc);
  useSignalDiagnostics(videoRef);

  const eventMeta = useCallback(() => ({
    guideId: nowPlaying?.guideId ?? null,
    channelId: nowPlaying?.channelId ?? null,
    sourceId: nowPlaying?.sourceId ?? null,
    programId: nowPlaying?.programId ?? null,
    assetId: nowPlaying?.assetId ?? null,
    archiveIdentifier: nowPlaying?.assetId ?? null,
    mediaPath: nowPlaying?.archivePath ?? activeSrc ?? null,
  }), [nowPlaying, activeSrc]);

  useEffect(() => {
    setActiveSrc(src);
    setArchiveFallbackUsed(false);
    setStatusText("Loading…");
  }, [src]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.load();

    const onPlay = () => {
      setIsPlaying(true); setStatusText("Playing");
      reportTelemetry({ event: "playback.started", ...eventMeta() });
      onPlayEvent?.();
    };
    const onPause = () => {
      setIsPlaying(false);
      reportTelemetry({ event: "playback.paused", ...eventMeta() });
      onPauseEvent?.();
    };
    const onEnded = () => {
      setIsPlaying(false);
      reportTelemetry({ event: "playback.ended", ...eventMeta() });
      window.setTimeout(() => onProgramEnded?.(), 0);
    };
    const onError = () => {
      const err = vid.error;

      // If the local Archive proxy cannot supply a browser-decodable response,
      // retry the exact validated /download path directly from Archive.org.
      // This is not an arbitrary URL fallback: it is derived only from the
      // app's own /api/archive/proxy?path=/download/... transport reference.
      if (
        err?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED &&
        isArchiveProxy &&
        !archiveFallbackUsed
      ) {
        try {
          const parsed = new URL(activeSrc, window.location.origin);
          const archivePath = parsed.searchParams.get("path");
          if (archivePath && archivePath.startsWith("/download/") && !archivePath.includes("://") && !archivePath.includes("..")) {
            const directArchiveSrc = `https://archive.org${archivePath}`;
            console.warn("[AJN PLAYBACK] proxy decode failed; retrying native Archive.org transport", {
              proxySrc: activeSrc,
              directArchiveSrc,
            });
            setArchiveFallbackUsed(true);
            setStatusText("Retrying Archive.org native transport…");
            setActiveSrc(directArchiveSrc);
            return;
          }
        } catch {
          // Fall through to the normal error report.
        }
      }

      setStatusText(`Failed to load — ${err ? `code ${err.code}: ${err.message || "no message"}` : "upstream error"}`);
      reportTelemetry({
        event: "media.error",
        ...eventMeta(),
        mediaErrorCode: err?.code ?? null,
        mediaErrorMessage: err?.message ?? null,
        readyState: vid.readyState,
        networkState: vid.networkState,
      });
      onErrorEvent?.(err);
    };

    vid.addEventListener("play", onPlay);
    vid.addEventListener("pause", onPause);
    vid.addEventListener("ended", onEnded);
    vid.addEventListener("error", onError);
    return () => {
      vid.removeEventListener("play", onPlay);
      vid.removeEventListener("pause", onPause);
      vid.removeEventListener("ended", onEnded);
      vid.removeEventListener("error", onError);
    };
  }, [activeSrc, archiveFallbackUsed, eventMeta, isArchiveProxy, onErrorEvent, onPauseEvent, onPlayEvent, onProgramEnded]);

  const play = async () => {
    const vid = videoRef.current;
    if (!vid) return;
    try { await vid.play(); } catch { setStatusText("Playback blocked — click play to start"); }
  };
  const pause = () => videoRef.current?.pause();

  return (
    <div ref={containerRef} className="relative aspect-video w-full bg-black">
      <video
        key={activeSrc}
        ref={videoRef}
        src={activeSrc}
        playsInline
        preload="metadata"
        className="h-full w-full"
      />
      <div className="absolute bottom-0 left-0 right-0 p-3 bg-black/60 flex items-center gap-2">
        <button onClick={isPlaying ? pause : play} aria-label={isPlaying ? "Pause" : "Play"}>{isPlaying ? <Pause /> : <Play />}</button>
        <button onClick={() => { const v=videoRef.current; if(v){v.muted=!v.muted;setIsMuted(v.muted)} }} aria-label="Mute">{isMuted ? <VolumeX/> : <Volume2/>}</button>
        <span className="text-xs text-white">{statusText}</span>
      </div>
    </div>
  );
}
