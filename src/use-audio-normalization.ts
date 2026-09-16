import { useRef, useState, useEffect, useCallback, RefObject } from "react";

const TARGET_DBFS = -18;
const SAMPLE_DURATION_S = 3;
const RAMP_DURATION_S = 1;
const DB_MIN = -12;
const DB_MAX = 12;
const LS_GAIN_KEY = "tvnews-gain-db";
const LS_AUTONORM_KEY = "tvnews-autonorm";

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

function linearToDb(linear: number): number {
  if (linear <= 0) return -Infinity;
  return 20 * Math.log10(linear);
}

export interface AudioNormalizationReturn {
  gainDb: number;
  setGainDb: (db: number) => void;
  autoNormalize: boolean;
  setAutoNormalize: (on: boolean) => void;
  audioContextSuspended: boolean;
  resumeAudioContext: () => void;
  setMasterVolume: (vol: number) => void;
  bridgeReady: boolean;
  primeAudioContext: () => void;
  preAnalyserRef: RefObject<AnalyserNode | null>;
  audioCtxRef: RefObject<AudioContext | null>;
  diagnosticsAnalyserRef: RefObject<AnalyserNode | null>;
  diagnosticsReady: boolean;
}

export function useAudioNormalization(
  mediaRef: RefObject<HTMLMediaElement | null>,
  playerType: "video" | "hls" | "iframe" | "audio" | "skip",
  clipKey: string,
): AudioNormalizationReturn {
  const [gainDb, setGainDbState] = useState<number>(() => {
    const saved = parseFloat(localStorage.getItem(LS_GAIN_KEY) ?? "0");
    return isNaN(saved) ? 0 : Math.max(DB_MIN, Math.min(DB_MAX, saved));
  });
  const [autoNormalize, setAutoNormalizeState] = useState<boolean>(
    () => localStorage.getItem(LS_AUTONORM_KEY) === "on"
  );
  const [audioContextSuspended, setAudioContextSuspended] = useState(false);
  const [bridgeReady, setBridgeReady] = useState(false);
  const [diagnosticsReady, setDiagnosticsReady] = useState(false);
  const bridgeReadyRef = useRef(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const masterVolumeNodeRef = useRef<GainNode | null>(null);
  const compressorNodeRef = useRef<DynamicsCompressorNode | null>(null);
  const preAnalyserRef = useRef<AnalyserNode | null>(null);
  const diagnosticsAnalyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const connectedElementRef = useRef<HTMLMediaElement | null>(null);
  const masterVolTargetRef = useRef<number>(1);

  const gainDbRef = useRef(gainDb);
  gainDbRef.current = gainDb;
  const autoNormalizeRef = useRef(autoNormalize);
  autoNormalizeRef.current = autoNormalize;

  const sampleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sampleIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const samplingActiveRef = useRef(false);

  const getOrCreateContext = useCallback((): AudioContext | null => {
    if (audioCtxRef.current) return audioCtxRef.current;
    try {
      const AudioContextImpl = window.AudioContext ?? window.webkitAudioContext;
      if (!AudioContextImpl) {
        console.debug("[audio-norm] AudioContext not available");
        return null;
      }
      const ctx = new AudioContextImpl();
      const gainNode = ctx.createGain();
      const preAnalyser = ctx.createAnalyser();
      preAnalyser.fftSize = 2048;
      const diagnosticsAnalyser = ctx.createAnalyser();
      diagnosticsAnalyser.fftSize = 256;
      const masterVolumeNode = ctx.createGain();
      masterVolumeNode.gain.value = 1;
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 6;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;

      preAnalyser.connect(gainNode);
      preAnalyser.connect(diagnosticsAnalyser);
      gainNode.connect(masterVolumeNode);
      masterVolumeNode.connect(compressor);
      compressor.connect(ctx.destination);

      audioCtxRef.current = ctx;
      gainNodeRef.current = gainNode;
      masterVolumeNodeRef.current = masterVolumeNode;
      compressorNodeRef.current = compressor;
      preAnalyserRef.current = preAnalyser;
      diagnosticsAnalyserRef.current = diagnosticsAnalyser;

      setAudioContextSuspended(ctx.state === "suspended");
      ctx.addEventListener("statechange", () => {
        const suspended = ctx.state !== "running";
        setAudioContextSuspended(suspended);
        if (suspended && bridgeReadyRef.current) {
          ctx.resume().catch(() => {});
        }
      });

      return ctx;
    } catch {
      return null;
    }
  }, []);

  const connectMediaElement = useCallback((media: HTMLMediaElement) => {
    const ctx = getOrCreateContext();
    if (!ctx || !preAnalyserRef.current) return;
    if (connectedElementRef.current === media) return;

    const crossoriginAttr = media.getAttribute("crossorigin");
    const hasCORSAttr = crossoriginAttr === "anonymous" || crossoriginAttr === "use-credentials";
    if (!hasCORSAttr) {
      connectedElementRef.current = media;
      setDiagnosticsReady(false);
      fetch("/api/watchdog/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "AUDIO_NATIVE_FALLBACK",
          ctxState: ctx.state,
          crossOrigin: crossoriginAttr ?? "none",
          src: media.src?.slice(0, 120),
          ts: Date.now(),
        }),
      }).catch(() => {});
      return;
    }

    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.disconnect(); } catch {}
      sourceNodeRef.current = null;
    }

    try {
      const source = ctx.createMediaElementSource(media);
      source.connect(preAnalyserRef.current);
      sourceNodeRef.current = source;
      connectedElementRef.current = media;
      bridgeReadyRef.current = true;
      setBridgeReady(true);
      setDiagnosticsReady(true);
      fetch("/api/watchdog/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "AUDIO_BRIDGE_OK",
          ctxState: ctx.state,
          crossOrigin: media.crossOrigin,
          src: media.src?.slice(0, 120),
          ts: Date.now(),
        }),
      }).catch(() => {});
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      console.warn("[audio-norm] createMediaElementSource failed:", msg);
      setDiagnosticsReady(false);
      fetch("/api/watchdog/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "AUDIO_BRIDGE_FAILED",
          error: msg,
          ctxState: ctx.state,
          crossOrigin: media.crossOrigin,
          src: media.src?.slice(0, 120),
          ts: Date.now(),
        }),
      }).catch(() => {});
    }
  }, [getOrCreateContext]);

  const resumeRetryCountRef = useRef(0);
  const MAX_RESUME_ATTEMPTS = 6;
  const RESUME_RETRY_MS = 400;

  const resumeAudioContext = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    if (ctx.state !== "running") {
      resumeRetryCountRef.current = 0;
      const attemptResume = () => {
        const c = audioCtxRef.current;
        if (!c || c.state === "running") return;
        if (resumeRetryCountRef.current >= MAX_RESUME_ATTEMPTS) return;
        resumeRetryCountRef.current += 1;
        c.resume().then(() => {
          if (c.state !== "running") setTimeout(attemptResume, RESUME_RETRY_MS);
        }).catch(() => setTimeout(attemptResume, RESUME_RETRY_MS));
      };
      attemptResume();
    }
  }, []);

  const primeAudioContext = useCallback(() => {
    getOrCreateContext();
    resumeAudioContext();
  }, [getOrCreateContext, resumeAudioContext]);

  const applyGain = useCallback((db: number, ramp = false) => {
    const gainNode = gainNodeRef.current;
    const ctx = audioCtxRef.current;
    if (!gainNode || !ctx) return;
    const linearVal = dbToLinear(db);
    if (ramp) gainNode.gain.linearRampToValueAtTime(linearVal, ctx.currentTime + RAMP_DURATION_S);
    else gainNode.gain.setValueAtTime(linearVal, ctx.currentTime);
  }, []);

  const MASTER_FADE_S = 0.5;
  const setMasterVolume = useCallback((vol: number) => {
    const node = masterVolumeNodeRef.current;
    const ctx = audioCtxRef.current;
    if (!node || !ctx) return;
    const clamped = Math.max(0, Math.min(1, vol));
    masterVolTargetRef.current = clamped;
    node.gain.cancelScheduledValues(ctx.currentTime);
    node.gain.setValueAtTime(node.gain.value, ctx.currentTime);
    node.gain.linearRampToValueAtTime(clamped, ctx.currentTime + MASTER_FADE_S);
  }, []);

  const startNormalizationSampling = useCallback(() => {
    const analyser = preAnalyserRef.current;
    const ctx = audioCtxRef.current;
    const gainNode = gainNodeRef.current;
    if (!analyser || !ctx || !gainNode || ctx.state !== "running" || samplingActiveRef.current) return;
    samplingActiveRef.current = true;
    clearTimeout(sampleTimerRef.current);
    clearInterval(sampleIntervalRef.current);
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Float32Array(bufferLength);
    let sumSquares = 0;
    let sampleCount = 0;
    sampleIntervalRef.current = setInterval(() => {
      if (ctx.state !== "running") return;
      analyser.getFloatTimeDomainData(dataArray);
      let ss = 0;
      for (let i = 0; i < bufferLength; i += 1) ss += dataArray[i] * dataArray[i];
      sumSquares += ss / bufferLength;
      sampleCount += 1;
    }, 100);
    sampleTimerRef.current = setTimeout(() => {
      samplingActiveRef.current = false;
      clearInterval(sampleIntervalRef.current);
      if (!autoNormalizeRef.current || sampleCount === 0) return;
      const rms = Math.sqrt(sumSquares / sampleCount);
      if (rms < 1e-6) return;
      const rawDb = linearToDb(rms);
      const compensationDb = TARGET_DBFS - rawDb;
      const totalDb = Math.max(DB_MIN, Math.min(DB_MAX, gainDbRef.current + compensationDb));
      gainNode.gain.linearRampToValueAtTime(dbToLinear(totalDb), ctx.currentTime + RAMP_DURATION_S);
    }, SAMPLE_DURATION_S * 1000);
  }, []);

  const setGainDb = useCallback((db: number) => {
    const clamped = Math.max(DB_MIN, Math.min(DB_MAX, db));
    localStorage.setItem(LS_GAIN_KEY, String(clamped));
    setGainDbState(clamped);
    applyGain(clamped, true);
  }, [applyGain]);

  const setAutoNormalize = useCallback((on: boolean) => {
    localStorage.setItem(LS_AUTONORM_KEY, on ? "on" : "off");
    setAutoNormalizeState(on);
    if (on) startNormalizationSampling();
  }, [startNormalizationSampling]);

  useEffect(() => {
    if (playerType === "iframe" || playerType === "skip") return;
    const media = mediaRef.current;
    if (!media) return;
    const ctx = getOrCreateContext();
    if (!ctx) return;
    let attached = false;
    const doConnect = () => {
      connectMediaElement(media);
      attached = true;
    };
    if (ctx.state === "running") {
      doConnect();
      return;
    }
    const onStateChange = () => {
      if (ctx.state === "running") doConnect();
    };
    ctx.addEventListener("statechange", onStateChange);
    resumeAudioContext();
    if (ctx.state === "running") doConnect();
    return () => {
      ctx.removeEventListener("statechange", onStateChange);
      if (!attached) console.debug("[audio-norm] bridge cleanup before attachment");
    };
  }, [mediaRef, playerType, clipKey, connectMediaElement, resumeAudioContext, getOrCreateContext]);

  useEffect(() => {
    if (!autoNormalize || (playerType !== "video" && playerType !== "hls" && playerType !== "audio")) return;
    const media = mediaRef.current;
    if (!media) return;
    connectMediaElement(media);
    const onPlaying = () => startNormalizationSampling();
    media.addEventListener("playing", onPlaying);
    return () => media.removeEventListener("playing", onPlaying);
  }, [autoNormalize, playerType, clipKey, mediaRef, connectMediaElement, startNormalizationSampling]);

  useEffect(() => {
    const handleGesture = () => {
      const ctx = audioCtxRef.current;
      if (ctx && ctx.state !== "running") resumeAudioContext();
    };
    window.addEventListener("pointerdown", handleGesture, { passive: true });
    window.addEventListener("keydown", handleGesture);
    return () => {
      window.removeEventListener("pointerdown", handleGesture);
      window.removeEventListener("keydown", handleGesture);
    };
  }, [resumeAudioContext]);

  return {
    gainDb,
    setGainDb,
    autoNormalize,
    setAutoNormalize,
    audioContextSuspended,
    resumeAudioContext,
    setMasterVolume,
    bridgeReady,
    primeAudioContext,
    preAnalyserRef,
    audioCtxRef,
    diagnosticsAnalyserRef,
    diagnosticsReady,
  };
}
