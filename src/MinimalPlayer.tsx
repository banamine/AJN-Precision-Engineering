import { useCallback, useEffect, useRef, useState } from "react";
import { reportTelemetry } from "./telemetry";
import { NowPlayingMedia, MediaType } from "./types";
import { Play, Pause, Volume2, VolumeX } from "lucide-react";
import { useAudioNormalization } from "./use-audio-normalization";
import { AudioBridgeStatus } from "./components/AudioBridgeStatus";

interface MinimalPlayerProps {
  src: string;
  title?: string;
  mediaType?: MediaType;
  onProgramEnded?: () => void;
  nowPlaying?: NowPlayingMedia;
  onPlayEvent?: () => void;
  onPauseEvent?: () => void;
  onErrorEvent?: (err: MediaError | null) => void;
}

const TV_NEWS_SLICE_SEC = 300;
const TV_NEWS_TOTAL_SEC = 3600;

export default function MinimalPlayer({ src, title, mediaType = "video", onProgramEnded, nowPlaying, onPlayEvent, onPauseEvent, onErrorEvent }: MinimalPlayerProps) {
  const mediaRef = useRef<HTMLMediaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [statusText, setStatusText] = useState("Loading…");
  const [activeSrc, setActiveSrc] = useState(src);
  const [archiveFallbackUsed, setArchiveFallbackUsed] = useState(false);

  const isVideo = mediaType === "video";
  const isArchiveProxy = activeSrc.startsWith("/api/archive/proxy?path=");

  const { diagnosticsAnalyserRef } = useAudioNormalization(
    mediaRef,
    isVideo ? "video" : "audio",
    activeSrc,
  );

  const eventMeta = useCallback(() => ({
    guideId: nowPlaying?.guideId ?? null,
    channelId: nowPlaying?.channelId ?? null,
    sourceId: nowPlaying?.sourceId ?? null,
    programId: nowPlaying?.programId ?? null,
    assetId: nowPlaying?.assetId ?? null,
    mediaPath: nowPlaying?.archivePath ?? activeSrc ?? null,
  }), [nowPlaying, activeSrc]);

  useEffect(() => {
    setActiveSrc(src);
    setArchiveFallbackUsed(false);
    setStatusText("Loading…");
  }, [src, mediaType]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    media.load();

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
      const err = media.error;

      if (
        err?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED &&
        isVideo &&
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
        readyState: media.readyState,
        networkState: media.networkState,
      });
      onErrorEvent?.(err);
    };

    media.addEventListener("play", onPlay);
    media.addEventListener("pause", onPause);
    media.addEventListener("ended", onEnded);
    media.addEventListener("error", onError);
    return () => {
      media.removeEventListener("play", onPlay);
      media.removeEventListener("pause", onPause);
      media.removeEventListener("ended", onEnded);
      media.removeEventListener("error", onError);
    };
  }, [activeSrc, archiveFallbackUsed, eventMeta, isArchiveProxy, isVideo, onErrorEvent, onPauseEvent, onPlayEvent, onProgramEnded]);

  const play = async () => {
    const media = mediaRef.current;
    if (!media) return;
    try { await media.play(); } catch { setStatusText("Playback blocked — click play to start"); }
  };
  const pause = () => mediaRef.current?.pause();

  return (
    <div ref={containerRef} className={`relative ${isVideo ? "aspect-video w-full bg-black" : "w-full rounded-xl bg-neutral-950 p-4"}`}>
      {isVideo ? (
        <video
          key={`${mediaType}:${activeSrc}`}
          ref={(node) => {
            mediaRef.current = node;
          }}
          src={activeSrc}
          playsInline
          preload="metadata"
          className="h-full w-full"
        />
      ) : (
        <audio
          key={`${mediaType}:${activeSrc}`}
          ref={(node) => {
            mediaRef.current = node;
          }}
          src={activeSrc}
          preload="metadata"
          className="w-full"
        />
      )}
      <div className="mt-2 flex items-center gap-2 p-3 bg-black/60">
        <button onClick={isPlaying ? pause : play} aria-label={isPlaying ? "Pause" : "Play"}>{isPlaying ? <Pause /> : <Play />}</button>
        <button onClick={() => { const v=mediaRef.current; if(v){v.muted=!v.muted;setIsMuted(v.muted)} }} aria-label="Mute">{isMuted ? <VolumeX/> : <Volume2/>}</button>
        <span className="text-xs text-white">{title ? `${title} — ` : ""}{statusText}</span>
      </div>
      <div className="mt-3">
        <AudioBridgeStatus analyser={diagnosticsAnalyserRef.current} />
      </div>
    </div>
  );
}
