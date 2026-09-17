import { useRef, useState, useEffect, useCallback, RefObject } from "react";

const TARGET_DBFS = -18;
const SAMPLE_DURATION_S = 3;
const RAMP_DURATION_S = 1;
const DB_MIN = -12;
const DB_MAX = 12;
const LS_GAIN_KEY = "tvnews-gain-db";
const LS_AUTONORM_KEY = "tvnews-autonorm";

declare global { interface Window { webkitAudioContext?: typeof AudioContext; } }
function dbToLinear(db: number): number { return Math.pow(10, db / 20); }
function linearToDb(linear: number): number { if (linear <= 0) return -Infinity; return 20 * Math.log10(linear); }

export interface AudioNormalizationReturn {
  gainDb: number; setGainDb: (db: number) => void; autoNormalize: boolean; setAutoNormalize: (on: boolean) => void;
  audioContextSuspended: boolean; resumeAudioContext: () => void; setMasterVolume: (vol: number) => void;
  bridgeReady: boolean; primeAudioContext: () => void; preAnalyserRef: RefObject<AnalyserNode | null>;
  audioCtxRef: RefObject<AudioContext | null>; diagnosticsAnalyserRef: RefObject<AnalyserNode | null>; diagnosticsReady: boolean;
}
interface AudioRuntime {
  ctx: AudioContext; gainNode: GainNode; masterVolumeNode: GainNode; compressorNode: DynamicsCompressorNode;
  preAnalyser: AnalyserNode; diagnosticsAnalyser: AnalyserNode; sourceNode: MediaElementAudioSourceNode | null;
  connectedElement: HTMLMediaElement | null; listener: (() => void) | null; bridgeReady: boolean; diagnosticsReady: boolean; lastCrossOrigin: string | null;
}
let audioRuntime: AudioRuntime | null = null;
function getAudioContextImpl(): typeof AudioContext | null { return window.AudioContext ?? window.webkitAudioContext ?? null; }
function createAudioRuntime(): AudioRuntime | null {
  if (audioRuntime) return audioRuntime;
  try {
    const AudioContextImpl = getAudioContextImpl(); if (!AudioContextImpl) { console.debug("[audio-norm] AudioContext not available"); return null; }
    const ctx = new AudioContextImpl(); const gainNode = ctx.createGain(); const preAnalyser = ctx.createAnalyser(); preAnalyser.fftSize = 2048;
    const diagnosticsAnalyser = ctx.createAnalyser(); diagnosticsAnalyser.fftSize = 256; const masterVolumeNode = ctx.createGain(); masterVolumeNode.gain.value = 1;
    const compressor = ctx.createDynamicsCompressor(); compressor.threshold.value = -18; compressor.knee.value = 6; compressor.ratio.value = 4; compressor.attack.value = 0.003; compressor.release.value = 0.25;
    preAnalyser.connect(gainNode); preAnalyser.connect(diagnosticsAnalyser); gainNode.connect(masterVolumeNode); masterVolumeNode.connect(compressor); compressor.connect(ctx.destination);
    const runtime: AudioRuntime = { ctx, gainNode, masterVolumeNode, compressorNode: compressor, preAnalyser, diagnosticsAnalyser, sourceNode: null, connectedElement: null, listener: null, bridgeReady: false, diagnosticsReady: false, lastCrossOrigin: null };
    const onStateChange = () => { if (runtime.ctx.state === "closed") return; if (runtime.ctx.state === "running" && runtime.connectedElement && !runtime.sourceNode) connectMediaElementToRuntime(runtime.connectedElement); };
    runtime.listener = onStateChange; ctx.addEventListener("statechange", onStateChange); audioRuntime = runtime; return runtime;
  } catch { return null; }
}
function connectMediaElementToRuntime(media: HTMLMediaElement): AudioRuntime | null {
  const runtime = createAudioRuntime(); if (!runtime) return null;
  if (runtime.connectedElement === media && runtime.sourceNode) return runtime;

  // A new media element must never inherit the previous element's source node.
  // Clear the singleton bridge before the CORS/native-fallback decision so diagnostics
  // cannot remain attached to stale audio after a player switch.
  if (runtime.connectedElement !== media) {
    if (runtime.sourceNode) { try { runtime.sourceNode.disconnect(); } catch {} runtime.sourceNode = null; }
    runtime.connectedElement = null; runtime.bridgeReady = false; runtime.diagnosticsReady = false;
  }

  const crossoriginAttr = media.getAttribute("crossorigin"); const hasCORSAttr = crossoriginAttr === "anonymous" || crossoriginAttr === "use-credentials"; runtime.lastCrossOrigin = crossoriginAttr;
  if (!hasCORSAttr) {
    runtime.connectedElement = media; runtime.bridgeReady = false; runtime.diagnosticsReady = false;
    if (media instanceof HTMLAudioElement) fetch("/api/watchdog/heartbeat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "AUDIO_NATIVE_FALLBACK", ctxState: runtime.ctx.state, crossOrigin: crossoriginAttr ?? "none", src: media.src?.slice(0, 120), ts: Date.now() }) }).catch(() => {});
    return runtime;
  }
  try {
    const source = runtime.ctx.createMediaElementSource(media); source.connect(runtime.preAnalyser); runtime.sourceNode = source; runtime.connectedElement = media; runtime.bridgeReady = true; runtime.diagnosticsReady = true;
    fetch("/api/watchdog/heartbeat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "AUDIO_BRIDGE_OK", ctxState: runtime.ctx.state, crossOrigin: media.crossOrigin, src: media.src?.slice(0, 120), ts: Date.now() }) }).catch(() => {});
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e); console.warn("[audio-norm] createMediaElementSource failed:", msg); runtime.connectedElement = media; runtime.bridgeReady = false; runtime.diagnosticsReady = false;
    fetch("/api/watchdog/heartbeat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "AUDIO_BRIDGE_FAILED", error: msg, ctxState: runtime.ctx.state, crossOrigin: media.crossOrigin, src: media.src?.slice(0, 120), ts: Date.now() }) }).catch(() => {});
  }
  return runtime;
}

export function useAudioNormalization(mediaRef: RefObject<HTMLMediaElement | null>, playerType: "video" | "hls" | "iframe" | "audio" | "skip", clipKey: string): AudioNormalizationReturn {
  const [gainDb, setGainDbState] = useState<number>(() => { const saved = parseFloat(localStorage.getItem(LS_GAIN_KEY) ?? "0"); return isNaN(saved) ? 0 : Math.max(DB_MIN, Math.min(DB_MAX, saved)); });
  const [autoNormalize, setAutoNormalizeState] = useState<boolean>(() => localStorage.getItem(LS_AUTONORM_KEY) === "on");
  const [audioContextSuspended, setAudioContextSuspended] = useState(false); const [bridgeReady, setBridgeReady] = useState(false); const [diagnosticsReady, setDiagnosticsReady] = useState(false);
  const gainDbRef = useRef(gainDb); gainDbRef.current = gainDb; const autoNormalizeRef = useRef(autoNormalize); autoNormalizeRef.current = autoNormalize;
  const sampleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined); const sampleIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined); const samplingActiveRef = useRef(false); const resumeRetryCountRef = useRef(0); const [, forceRuntimeRefresh] = useState(0);
  const audioCtxRef = useRef<AudioContext | null>(null); const gainNodeRef = useRef<GainNode | null>(null); const masterVolumeNodeRef = useRef<GainNode | null>(null); const compressorNodeRef = useRef<DynamicsCompressorNode | null>(null); const preAnalyserRef = useRef<AnalyserNode | null>(null); const diagnosticsAnalyserRef = useRef<AnalyserNode | null>(null); const masterVolTargetRef = useRef<number>(1);
  const syncRuntimeRefs = useCallback((runtime: AudioRuntime | null) => { audioCtxRef.current = runtime?.ctx ?? null; gainNodeRef.current = runtime?.gainNode ?? null; masterVolumeNodeRef.current = runtime?.masterVolumeNode ?? null; compressorNodeRef.current = runtime?.compressorNode ?? null; preAnalyserRef.current = runtime?.preAnalyser ?? null; diagnosticsAnalyserRef.current = runtime?.diagnosticsAnalyser ?? null; setAudioContextSuspended(Boolean(runtime && runtime.ctx.state !== "running")); setBridgeReady(Boolean(runtime?.bridgeReady)); setDiagnosticsReady(Boolean(runtime?.diagnosticsReady)); }, []);
  const getOrCreateContext = useCallback((): AudioContext | null => { const runtime = createAudioRuntime(); syncRuntimeRefs(runtime); return runtime?.ctx ?? null; }, [syncRuntimeRefs]);
  const connectMediaElement = useCallback((media: HTMLMediaElement) => { const runtime = connectMediaElementToRuntime(media); syncRuntimeRefs(runtime); if (runtime && runtime.ctx.state === "running") forceRuntimeRefresh((value) => value + 1); }, [syncRuntimeRefs]);
  const resumeAudioContext = useCallback(() => { const runtime = audioRuntime; const ctx = runtime?.ctx; if (!ctx || ctx.state === "closed" || ctx.state === "running") return; resumeRetryCountRef.current = 0; const attemptResume = () => { const active = audioRuntime; const current = active?.ctx; if (!current || current.state === "closed" || current.state === "running") { if (active) syncRuntimeRefs(active); return; } if (resumeRetryCountRef.current >= 6) return; resumeRetryCountRef.current += 1; current.resume().then(() => { syncRuntimeRefs(active ?? null); if (current.state !== "running") setTimeout(attemptResume, 400); }).catch(() => setTimeout(attemptResume, 400)); }; attemptResume(); }, [syncRuntimeRefs]);
  const primeAudioContext = useCallback(() => { getOrCreateContext(); resumeAudioContext(); }, [getOrCreateContext, resumeAudioContext]);
  const applyGain = useCallback((db: number, ramp = false) => { const gainNode = audioRuntime?.gainNode; const ctx = audioRuntime?.ctx; if (!gainNode || !ctx || ctx.state === "closed") return; const linearVal = dbToLinear(db); if (ramp) gainNode.gain.linearRampToValueAtTime(linearVal, ctx.currentTime + RAMP_DURATION_S); else gainNode.gain.setValueAtTime(linearVal, ctx.currentTime); }, []);
  const MASTER_FADE_S = 0.5;
  const setMasterVolume = useCallback((vol: number) => { const node = audioRuntime?.masterVolumeNode; const ctx = audioRuntime?.ctx; if (!node || !ctx || ctx.state === "closed") return; const clamped = Math.max(0, Math.min(1, vol)); masterVolTargetRef.current = clamped; node.gain.cancelScheduledValues(ctx.currentTime); node.gain.setValueAtTime(node.gain.value, ctx.currentTime); node.gain.linearRampToValueAtTime(clamped, ctx.currentTime + MASTER_FADE_S); }, []);
  const startNormalizationSampling = useCallback(() => { const analyser = audioRuntime?.preAnalyser ?? null; const ctx = audioRuntime?.ctx ?? null; const gainNode = audioRuntime?.gainNode ?? null; if (!analyser || !ctx || !gainNode || ctx.state !== "running" || samplingActiveRef.current) return; samplingActiveRef.current = true; clearTimeout(sampleTimerRef.current); clearInterval(sampleIntervalRef.current); const bufferLength = analyser.frequencyBinCount; const dataArray = new Float32Array(bufferLength); let sumSquares = 0; let sampleCount = 0; sampleIntervalRef.current = setInterval(() => { if (ctx.state !== "running") return; analyser.getFloatTimeDomainData(dataArray); let ss = 0; for (let i = 0; i < bufferLength; i += 1) ss += dataArray[i] * dataArray[i]; sumSquares += ss / bufferLength; sampleCount += 1; }, 100); sampleTimerRef.current = setTimeout(() => { samplingActiveRef.current = false; clearInterval(sampleIntervalRef.current); if (!autoNormalizeRef.current || sampleCount === 0) return; const rms = Math.sqrt(sumSquares / sampleCount); if (rms < 1e-6) return; const rawDb = linearToDb(rms); const compensationDb = TARGET_DBFS - rawDb; const totalDb = Math.max(DB_MIN, Math.min(DB_MAX, gainDbRef.current + compensationDb)); gainNode.gain.linearRampToValueAtTime(dbToLinear(totalDb), ctx.currentTime + RAMP_DURATION_S); }, SAMPLE_DURATION_S * 1000); }, []);
  const setGainDb = useCallback((db: number) => { const clamped = Math.max(DB_MIN, Math.min(DB_MAX, db)); localStorage.setItem(LS_GAIN_KEY, String(clamped)); setGainDbState(clamped); applyGain(clamped, true); }, [applyGain]);
  const setAutoNormalize = useCallback((on: boolean) => { localStorage.setItem(LS_AUTONORM_KEY, on ? "on" : "off"); setAutoNormalizeState(on); if (on) startNormalizationSampling(); }, [startNormalizationSampling]);
  useEffect(() => { if (playerType === "iframe" || playerType === "skip") return; const media = mediaRef.current; if (!media) return; const runtime = createAudioRuntime(); if (!runtime) return; syncRuntimeRefs(runtime); const attach = () => { const activeRuntime = createAudioRuntime(); if (!activeRuntime) return; syncRuntimeRefs(activeRuntime); if (activeRuntime.ctx.state === "running") connectMediaElement(media); }; if (runtime.ctx.state === "running") { attach(); return; } const onStateChange = () => { if (runtime.ctx.state === "running") attach(); else syncRuntimeRefs(runtime); }; runtime.ctx.addEventListener("statechange", onStateChange); resumeAudioContext(); return () => { runtime.ctx.removeEventListener("statechange", onStateChange); }; }, [mediaRef, playerType, clipKey, connectMediaElement, resumeAudioContext, syncRuntimeRefs]);
  useEffect(() => { if (!autoNormalize || (playerType !== "video" && playerType !== "hls" && playerType !== "audio")) return; const media = mediaRef.current; if (!media) return; connectMediaElement(media); const onPlaying = () => startNormalizationSampling(); media.addEventListener("playing", onPlaying); return () => media.removeEventListener("playing", onPlaying); }, [autoNormalize, playerType, clipKey, mediaRef, connectMediaElement, startNormalizationSampling]);
  useEffect(() => { const handleGesture = () => { const ctx = audioRuntime?.ctx; if (ctx && ctx.state !== "running") resumeAudioContext(); }; window.addEventListener("pointerdown", handleGesture, { passive: true }); window.addEventListener("keydown", handleGesture); return () => { window.removeEventListener("pointerdown", handleGesture); window.removeEventListener("keydown", handleGesture); }; }, [resumeAudioContext]);
  useEffect(() => { if (!audioRuntime) return; applyGain(gainDbRef.current); }, [gainDb]);
  return { gainDb, setGainDb, autoNormalize, setAutoNormalize, audioContextSuspended, resumeAudioContext, setMasterVolume, bridgeReady, primeAudioContext, preAnalyserRef, audioCtxRef, diagnosticsAnalyserRef, diagnosticsReady };
}
