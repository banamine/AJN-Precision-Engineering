import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
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

// Session-wide sound choice: once the user unmutes, every later program
// (including scheduler auto-advance, which remounts this player) stays unmuted
// until the app is closed or reloaded.
let sessionUnmuted = false;

export default function MinimalPlayer({ src, title, mediaType = "video", onProgramEnded, nowPlaying, onPlayEvent, onPauseEvent, onErrorEvent, onProgressEvent }: MinimalPlayerProps) {
  const mediaRef = useRef<HTMLMediaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastSavedPositionRef = useRef(0);
  const playingReportedRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  // Autoplay starts muted on every app load. Once the user unmutes, keep that
  // choice for the rest of this app session; a reload intentionally resets it.
  const [isMuted, setIsMuted] = useState(() => !sessionUnmuted);
  const [volume, setVolume] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [statusText, setStatusText] = useState("Loading…");
  const [activeSrc, setActiveSrc] = useState(src);
  const [resumePosition, setResumePosition] = useState<number | null>(null);
  const [showResumePrompt, setShowResumePrompt] = useState(false);

  const isVideo = mediaType === "video";
  const isHls = /\.m3u8(\?|$)/i.test(activeSrc ?? "");
  const hlsRef = useRef<Hls | null>(null);
  // Only request CORS for our own origin (the Archive proxy). Hosts such as
  // archive.alexjoneslive.com send no CORS headers, so crossOrigin={corsMode}
  // makes the browser refuse the file outright. Without it the file plays and
  // the audio bridge falls back to native output.
  const corsMode = (activeSrc ?? "").startsWith("/") ? "anonymous" : undefined;
  // Read in effects without re-running them: toggling mute must not reload media.
  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;
  // Latest callbacks, read by the media effect so parent re-renders never re-run
  // it (a re-run calls load(), which aborts the play() in flight).
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
    titleId: `${nowPlaying?.channelId || 'none'}/${String(nowPlaying?.title ?? title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'untitled'}`,
    assetId: nowPlaying?.assetId ?? null,
    mediaPath: nowPlaying?.archivePath ?? activeSrc ?? null,
  }), [nowPlaying, activeSrc, title]);

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

  const fnRef = useRef({ eventMeta, readResumePosition, saveResumePosition, clearResumePosition, reportPlaying, onPauseEvent, onProgramEnded, onErrorEvent });
  fnRef.current = { eventMeta, readResumePosition, saveResumePosition, clearResumePosition, reportPlaying, onPauseEvent, onProgramEnded, onErrorEvent };

  useEffect(() => {
    setActiveSrc(src);
    setStatusText("Loading…");
    setIsPlaying(false);
    setResumePosition(null);
    setShowResumePrompt(false);
    playingReportedRef.current = false;
    lastSavedPositionRef.current = 0;
  }, [src, mediaType]);

  useEffect(() => {
    const fx = () => fnRef.current;
    const media = mediaRef.current;
    if (!media) return;

    // Set the property before attempting autoplay. This is required by
    // browser autoplay policy and avoids relying on JSX timing alone.
    media.muted = isMutedRef.current;
    media.load();

    const attemptAutoplay = async () => {
      if (!isVideo || !media.paused) return;
      try {
        await media.play();
        if (!media.paused) fx().reportPlaying();
      } catch (error) {
        if ((error as DOMException)?.name === "AbortError") return;
        // Unmuted autoplay refused (no user gesture yet in this tab): play muted
        // rather than stall the schedule. The session preference is unchanged.
        if (!media.muted && (error as DOMException)?.name === 'NotAllowedError') {
          media.muted = true;
          setIsMuted(true);
          try { await media.play(); if (!media.paused) { fx().reportPlaying(); return; } } catch { /* fall through */ }
        }
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
      // Live streams have no fixed duration: never offer a resume position.
      const saved = Number.isFinite(media.duration) ? fx().readResumePosition() : null;
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
    const onPlay = (...a: []) => fx().reportPlaying(...a);
    const onPlaying = (...a: []) => fx().reportPlaying(...a);
    const onTimeUpdate = () => {
      if (!media.paused) {
        fx().reportPlaying();
        fx().saveResumePosition(media);
      }
    };
    const onWaiting = () => setStatusText("Buffering…");
    const onStalled = () => setStatusText("Network stalled…");
    const onPause = () => {
      setIsPlaying(false);
      fx().saveResumePosition(media);
      reportTelemetry({ event: "playback.paused", ...eventMeta() });
      fx().onPauseEvent?.();
    };
    const onEnded = () => {
      setIsPlaying(false);
      playingReportedRef.current = false;
      fx().clearResumePosition();
      reportTelemetry({ event: "playback.ended", ...eventMeta() });
      window.setTimeout(() => fx().onProgramEnded?.(), 0);
    };
    const onError = () => {
      const err = media.error;

      // No silent switch to direct archive.org: that bypassed proxy validation,
      // retries and telemetry, and a cross-origin source silences the audio chain.
      // A failure is shown as a failure.
      setStatusText(`Failed to load — ${err ? `code ${err.code}: ${err.message || "no message"}` : "upstream error"}`);
      reportTelemetry({
        event: "media.error",
        ...eventMeta(),
        mediaErrorCode: err?.code ?? null,
        mediaErrorMessage: err?.message ?? null,
        readyState: media.readyState,
        networkState: media.networkState,
      });
      fx().onErrorEvent?.(err);
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

    const saveOnExit = () => fx().saveResumePosition(media);
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
      fx().saveResumePosition(media);
    };
  // Deliberately keyed on the source only: re-running calls load(), which
  // aborts any play() in flight ("interrupted by a new load request").
  }, [activeSrc, isVideo]);

  // HLS (.m3u8): native where the browser supports it (Safari), otherwise hls.js.
  // Teardown order is fixed: stopLoad -> detachMedia -> destroy -> null. Skipping
  // it leaves SourceBuffers and loaders running and memory grows on long sessions.
  useEffect(() => {
    const media = mediaRef.current;
    if (!media || !isHls) return;
    if (media.canPlayType("application/vnd.apple.mpegurl")) {
      media.src = activeSrc;
      return;
    }
    if (!Hls.isSupported()) {
      setStatusText("Failed to load — this browser cannot play HLS streams");
      return;
    }
    const hls = new Hls({ liveDurationInfinity: true, lowLatencyMode: false, backBufferLength: 30 });
    hlsRef.current = hls;
    let recoveries = 0;
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      // One recovery attempt per kind before reporting a real failure.
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && recoveries < 2) { recoveries++; hls.startLoad(); return; }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && recoveries < 2) { recoveries++; hls.recoverMediaError(); return; }
      setStatusText(`Failed to load — HLS ${data.type}: ${data.details}`);
      reportTelemetry({ event: "media.error", ...fnRef.current.eventMeta(), hlsType: data.type, hlsDetails: data.details, httpStatus: (data.response as { code?: number } | undefined)?.code ?? null });
      fnRef.current.onErrorEvent?.(null);
    });
    hls.loadSource(activeSrc);
    hls.attachMedia(media);
    return () => {
      hls.stopLoad();
      hls.detachMedia();
      hls.destroy();
      hlsRef.current = null;
    };
  }, [activeSrc, isHls]);

  const play = async () => {
    const media = mediaRef.current;
    if (!media) return;
    setStatusText("Starting playback…");
    try {
      await media.play();
      if (!media.paused) reportPlaying();
    } catch (error) {
      // A newer load superseded this play(); the new source starts on its own.
      if ((error as DOMException)?.name === "AbortError") return;
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
    sessionUnmuted = !nextMuted;
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
          src={isHls ? undefined : activeSrc}
          crossOrigin={corsMode}
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
          crossOrigin={corsMode}
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
