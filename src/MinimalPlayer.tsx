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
  onProgressEvent?: (positionSeconds: number) => void;
}

const TV_NEWS_SLICE_SEC = 300;
const TV_NEWS_TOTAL_SEC = 3600;
const RESUME_MIN_SEC = 5;
const RESUME_SAVE_INTERVAL_MS = 5000;
const RESUME_PREFIX = "ajn-playback-position:";

export default function MinimalPlayer({ src, title, mediaType = "video", onProgramEnded, nowPlaying, onPlayEvent, onPauseEvent, onErrorEvent, onProgressEvent }: MinimalPlayerProps) {
  const mediaRef = useRef<HTMLMediaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastSavedPositionRef = useRef(0);
  const playingReportedRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  // Autoplay starts muted on every app load. Once the user unmutes, keep that
  // choice for the rest of this app session; a reload intentionally resets it.
  const [isMuted, setIsMuted] = useState(true);
  const [volume, setVolume] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [statusText, setStatusText] = useState("Loading…");
  const [activeSrc, setActiveSrc] = useState(src);
  const [archiveFallbackUsed, setArchiveFallbackUsed] = useState(false);
  const [resumePosition, setResumePosition] = useState<number | null>(null);
  const [showResumePrompt, setShowResumePrompt] = useState(false);

  const isVideo = mediaType === "video";
  const isArchiveProxy = activeSrc.startsWith("/api/archive/proxy?path=");
  const resumeKey = `${RESUME_PREFIX}${nowPlaying?.programId ?? activeSrc}`;

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

  const readResumePosition = useCallback(() => {
    try {
      const saved = Number.parseFloat(localStorage.getItem(resumeKey) ?? "");
      return Number.isFinite(saved) && saved >= RESUME_MIN_SEC ? saved : null;
    } catch {
      return null;
    }
  }, [onProgressEvent, resumeKey]);

  const saveResumePosition = useCallback((media: HTMLMediaElement) => {
    if (Number.isFinite(media.currentTime)) onProgressEvent?.(media.currentTime);
    if (!Number.isFinite(media.currentTime) || media.currentTime < RESUME_MIN_SEC) return;
    if (Number.isFinite(media.duration) && media.duration > 0 && media.currentTime >= media.duration - 5) {
      try { localStorage.removeItem(resumeKey); } catch {}
      return;
    }
    const now = Date.now();
    if (now - lastSavedPositionRef.current < RESUME_SAVE_INTERVAL_MS) return;
    lastSavedPositionRef.current = now;
    try { localStorage.setItem(resumeKey, String(media.currentTime)); } catch {}
  }, [resumeKey]);

  const clearResumePosition = useCallback(() => {
    try { localStorage.removeItem(resumeKey); } catch {}
    setResumePosition(null);
    setShowResumePrompt(false);
  }, [resumeKey]);

  const reportPlaying = useCallback(() => {
    setIsPlaying(true);
    setStatusText("Playing");
    if (!playingReportedRef.current) {
      playingReportedRef.current = true;
      reportTelemetry({ event: "playback.started", ...eventMeta() });
      onPlayEvent?.();
    }
  }, [eventMeta, onPlayEvent]);

  useEffect(() => {
    setActiveSrc(src);
    setArchiveFallbackUsed(false);
    setStatusText("Loading…");
    setIsPlaying(false);
    setResumePosition(null);
    setShowResumePrompt(false);
    playingReportedRef.current = false;
    lastSavedPositionRef.current = 0;
  }, [src, mediaType]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;

    // Set the property before attempting autoplay. This is required by
    // browser autoplay policy and avoids relying on JSX timing alone.
    media.muted = isMuted;
    media.load();

    const attemptAutoplay = async () => {
      if (!isVideo || !media.paused) return;
      try {
        await media.play();
        if (!media.paused) reportPlaying();
      } catch (error) {
        // Autoplay may still be blocked by the browser. Keep the real error
        // available in the console; the normal Play control remains usable.
        console.warn("[AJN PLAYBACK] autoplay blocked", {
          src: media.currentSrc,
          muted: media.muted,
          error,
          readyState: media.readyState,
          networkState: media.networkState,
        });
        if (media.paused) setStatusText("Ready to play");
      }
    };

    const onLoadedMetadata = () => {
      const saved = readResumePosition();
      setStatusText("Ready");
      if (saved !== null && (!Number.isFinite(media.duration) || saved < media.duration - 5)) {
        setResumePosition(saved);
        setShowResumePrompt(true);
      }
      void attemptAutoplay();
    };
    const onCanPlay = () => {
      if (media.paused) {
        setStatusText("Ready to play");
        void attemptAutoplay();
      }
    };
    const onPlay = reportPlaying;
    const onPlaying = reportPlaying;
    const onTimeUpdate = () => {
      if (!media.paused) {
        reportPlaying();
        saveResumePosition(media);
      }
    };
    const onWaiting = () => setStatusText("Buffering…");
    const onStalled = () => setStatusText("Network stalled…");
    const onPause = () => {
      setIsPlaying(false);
      saveResumePosition(media);
      reportTelemetry({ event: "playback.paused", ...eventMeta() });
      onPauseEvent?.();
    };
    const onEnded = () => {
      setIsPlaying(false);
      playingReportedRef.current = false;
      clearResumePosition();
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

    media.addEventListener("loadedmetadata", onLoadedMetadata);
    media.addEventListener("canplay", onCanPlay);
    media.addEventListener("play", onPlay);
    media.addEventListener("playing", onPlaying);
    media.addEventListener("timeupdate", onTimeUpdate);
    media.addEventListener("waiting", onWaiting);
    media.addEventListener("stalled", onStalled);
    media.addEventListener("pause", onPause);
    media.addEventListener("ended", onEnded);
    media.addEventListener("error", onError);

    const saveOnExit = () => saveResumePosition(media);
    window.addEventListener("pagehide", saveOnExit);

    return () => {
      media.removeEventListener("loadedmetadata", onLoadedMetadata);
      media.removeEventListener("canplay", onCanPlay);
      media.removeEventListener("play", onPlay);
      media.removeEventListener("playing", onPlaying);
      media.removeEventListener("timeupdate", onTimeUpdate);
      media.removeEventListener("waiting", onWaiting);
      media.removeEventListener("stalled", onStalled);
      media.removeEventListener("pause", onPause);
      media.removeEventListener("ended", onEnded);
      media.removeEventListener("error", onError);
      window.removeEventListener("pagehide", saveOnExit);
      saveResumePosition(media);
    };
  }, [activeSrc, archiveFallbackUsed, clearResumePosition, eventMeta, isArchiveProxy, isMuted, isVideo, onErrorEvent, onPauseEvent, onProgramEnded, readResumePosition, reportPlaying, saveResumePosition]);

  const play = async () => {
    const media = mediaRef.current;
    if (!media) return;
    setStatusText("Starting playback…");
    try {
      await media.play();
      if (!media.paused) reportPlaying();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusText(`Playback failed — ${message}`);
      console.error("[AJN PLAYBACK] play() rejected", {
        src: media.currentSrc,
        error,
        readyState: media.readyState,
        networkState: media.networkState,
        mediaError: media.error,
      });
    }
  };
  const pause = () => mediaRef.current?.pause();

  const resume = async () => {
    const media = mediaRef.current;
    if (!media || resumePosition === null) return;
    try {
      media.currentTime = Math.min(resumePosition, Math.max(0, media.duration - 1));
      setShowResumePrompt(false);
      await media.play();
    } catch (error) {
      console.error("[AJN PLAYBACK] resume() rejected", error);
      setStatusText(`Playback failed — ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const startOver = () => {
    const media = mediaRef.current;
    clearResumePosition();
    if (media) media.currentTime = 0;
  };

  const toggleMute = () => {
    const media = mediaRef.current;
    if (!media) return;
    const nextMuted = !media.muted;
    media.muted = nextMuted;
    setIsMuted(nextMuted);
  };

  return (
    <div ref={containerRef} className={`relative ${isVideo ? "aspect-video w-full bg-black" : "w-full rounded-xl bg-neutral-950 p-4"}`}>
      {isVideo ? (
        <video
          key={`${mediaType}:${activeSrc}`}
          ref={(node) => {
            mediaRef.current = node;
            if (node) node.muted = isMuted;
          }}
          src={activeSrc}
          autoPlay
          muted={isMuted}
          playsInline
          preload="metadata"
          className="h-full w-full"
        />
      ) : (
        <audio
          key={`${mediaType}:${activeSrc}`}
          ref={(node) => {
            mediaRef.current = node;
            if (node) node.muted = isMuted;
          }}
          src={activeSrc}
          muted={isMuted}
          crossOrigin="anonymous"
          preload="metadata"
          className="w-full"
        />
      )}
      {showResumePrompt && resumePosition !== null && (
        <div className="absolute left-3 right-3 top-3 z-10 flex items-center justify-between gap-3 rounded-lg bg-black/85 p-3 text-white shadow-lg">
          <span className="text-sm">Resume from {Math.floor(resumePosition / 60)}:{String(Math.floor(resumePosition % 60)).padStart(2, "0")}?</span>
          <div className="flex gap-2">
            <button onClick={resume} className="rounded bg-white px-3 py-1 text-xs font-medium text-black">Resume</button>
            <button onClick={startOver} className="rounded border border-white/40 px-3 py-1 text-xs">Start Over</button>
          </div>
        </div>
      )}
      <div className="mt-2 flex items-center gap-2 bg-black/60 p-3">
        <button onClick={isPlaying ? pause : play} aria-label={isPlaying ? "Pause" : "Play"}>{isPlaying ? <Pause /> : <Play />}</button>
        <button onClick={toggleMute} aria-label={isMuted ? "Unmute" : "Mute"}>{isMuted ? <VolumeX /> : <Volume2 />}</button>
        <span className="text-xs text-white">{title ? `${title} — ` : ""}{statusText}</span>
      </div>
      <div className="mt-3">
        <AudioBridgeStatus analyser={diagnosticsAnalyserRef.current} />
      </div>
    </div>
  );
}
