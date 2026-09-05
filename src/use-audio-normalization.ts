import { useRef, useState, useEffect, useCallback, RefObject } from "react";

const TARGET_DBFS = -18;
const SAMPLE_DURATION_S = 3;
const RAMP_DURATION_S = 1;
const DB_MIN = -12;
const DB_MAX = 12;
const LS_GAIN_KEY = "tvnews-gain-db";
const LS_AUTONORM_KEY = "tvnews-autonorm";

// Typed compatibility shim for Safari/older browsers
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
  /** Drive the Master Volume fader (0–1 linear). Ramps over 500 ms. */
  setMasterVolume: (vol: number) => void;
  /**
   * True once the first [AudioBridge] ✓ OK event fires for this session.
   * Use this to gate any frame-capture/recorder operations so you only
   * capture frames when audio is confirmed flowing to the Web Audio graph.
   */
  bridgeReady: boolean;
  /**
   * Eagerly create the AudioContext and attempt resume() in one call.
   * Use from the ?autoplay=true mount effect so CEF gets the resume request
   * before any clip loads — rather than waiting for the lazy Bus Bridge path.
   * Safe to call multiple times (idempotent via getOrCreateContext guard).
   */
  primeAudioContext: () => void;
  /**
   * Pre-gain AnalyserNode wired into the audio graph immediately after the
   * MediaElementSource. Exposed so external components (e.g. AudioVisualizer)
   * can read frequency data without creating a second MediaElementSource.
   */
  preAnalyserRef: RefObject<AnalyserNode | null>;

  // ── AudioController Singleton additions (M1) ──────────────────────────────
  /**
   * The single shared AudioContext instance. Consumers that need direct
   * context access (e.g. to check .state, or create their OWN downstream
   * nodes off diagnosticsAnalyserRef) read it from here instead of calling
   * `new AudioContext()` themselves. There is exactly one AudioContext per
   * player instance — this field IS the enforcement of that contract.
   */
  audioCtxRef: RefObject<AudioContext | null>;
  /**
   * Dedicated AnalyserNode for read-only diagnostic consumers (signal
   * health, black-frame/silent-audio detection, radio-mode detection).
   * Wired in parallel off the SAME MediaElementSource as preAnalyser —
   * see the graph diagram below. Consumers read from this node; they must
   * never call createMediaElementSource() themselves, and never create a
   * second AudioContext for the same video element. This is what
   * eliminates the InvalidStateError dual-ownership collision: there is
   * now exactly one owner of createMediaElementSource for the life of the
   * element, full stop.
   */
  diagnosticsAnalyserRef: RefObject<AnalyserNode | null>;
  /**
   * True once a MediaElementSource has been successfully created for the
   * current element AND the diagnostics analyser is wired and readable.
   * Diagnostic consumers should treat "diagnosticsReady === false" as "no
   * audio data available yet" rather than falling back to their own context.
   */
  diagnosticsReady: boolean;
}

export function useAudioNormalization(
  videoRef: RefObject<HTMLVideoElement | null>,
  playerType: "video" | "hls" | "iframe" | "skip",
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
  // True after the first [AudioBridge] ✓ OK — gates frame-capture operations.
  const [bridgeReady, setBridgeReady] = useState(false);
  const [diagnosticsReady, setDiagnosticsReady] = useState(false);
  // Stable ref mirror so the statechange closure (inside getOrCreateContext)
  // can check bridge status without capturing a stale value of bridgeReady.
  const bridgeReadyRef = useRef(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  // Master volume fader — driven by the UI volume slider (0–1 linear).
  // Sits after normalization gain so the two controls are orthogonal.
  const masterVolumeNodeRef = useRef<GainNode | null>(null);
  // DynamicsCompressor locked to the final output — acts as broadcast limiter
  // so the vMix/OBS feed maintains consistent loudness regardless of source.
  const compressorNodeRef = useRef<DynamicsCompressorNode | null>(null);
  // Pre-gain analyser: source → preAnalyser → gainNode → masterVolumeNode → compressor → destination.
  // Placed BEFORE the gain node so it measures raw clip loudness independently
  // of any user gain setting — userGainDb acts as a stable baseline offset.
  const preAnalyserRef = useRef<AnalyserNode | null>(null);
  // ── AudioController Singleton (M1) ──────────────────────────────────────
  // Diagnostics tap: a SECOND AnalyserNode wired in parallel off preAnalyser,
  // read-only, for signal-diagnostics consumers. This does NOT create a
  // second MediaElementSource — it branches off the one source node this
  // hook already owns. Graph:
  //
  //   source ─┬─→ preAnalyser ─→ gainNode ─→ masterVolumeNode ─→ compressor ─→ destination
  //           └─→ diagnosticsAnalyser   (parallel tap, read-only, no downstream connect)
  //
  // diagnosticsAnalyser connects to nothing further — an AnalyserNode with no
  // output connection still runs its analysis and is readable via
  // getByteFrequencyData/getFloatTimeDomainData. This is the standard
  // "silent tap" pattern and avoids adding any node into the live audio path.
  const diagnosticsAnalyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const connectedElementRef = useRef<HTMLVideoElement | null>(null);
  // Stored master-volume target so fade-in on clip change ramps back to it.
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
      console.debug("[audio-norm] AudioContext created, state:", ctx.state);
      const gainNode = ctx.createGain();
      const preAnalyser = ctx.createAnalyser();
      preAnalyser.fftSize = 2048;

      // ── Diagnostics tap (M1) ────────────────────────────────────────────────
      // Separate AnalyserNode, same fftSize expectations as the old
      // use-signal-diagnostics standalone context (256 there vs 2048 here —
      // diagnostics only needs frequency-domain averages, not fine resolution,
      // so we give it its own smaller fftSize independent of preAnalyser).
      const diagnosticsAnalyser = ctx.createAnalyser();
      diagnosticsAnalyser.fftSize = 256;

      // ── Master Volume fader ──────────────────────────────────────────────────
      // Sits after normalization gain — UI volume slider maps here (0–1 linear).
      const masterVolumeNode = ctx.createGain();
      masterVolumeNode.gain.value = 1; // full pass-through until slider drives it

      // ── Broadcast Limiter (Auto-EQ) ──────────────────────────────────────────
      // DynamicsCompressorNode locked to the final output so vMix/OBS always
      // receives a consistent broadcast level regardless of source loudness.
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -18;  // start compressing at -18 dBFS
      compressor.knee.value       =   6; // 6 dB soft knee
      compressor.ratio.value      =   4; // 4:1 ratio
      compressor.attack.value     = 0.003; // 3 ms attack
      compressor.release.value    = 0.25;  // 250 ms release

      // Wire the fixed edges once:
      //   preAnalyser → gainNode → masterVolumeNode → compressor → destination
      //   preAnalyser → diagnosticsAnalyser (parallel tap, no further output)
      // These never change — only the upstream source node is swapped per clip.
      preAnalyser.connect(gainNode);
      preAnalyser.connect(diagnosticsAnalyser); // read-only tap, doesn't touch main path
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
        // ── Mid-session recovery ──────────────────────────────────────────────
        // vMix can drop the context back to "suspended" or "interrupted" after
        // an audio-routing change (e.g. the operator drags the bus strip).
        // Once the bridge was successfully established (bridgeReady), the
        // MediaElementSource is exclusively on the Web Audio graph — native audio
        // is gone.  Silently re-attempt resume so the stream recovers on its own.
        if (suspended && bridgeReadyRef.current) {
          console.warn(
            `[AudioContext] statechange → ${ctx.state} mid-session ` +
            `(bridge was live) — auto-resuming`
          );
          ctx.resume().catch(() => {});
        }
      });

      return ctx;
    } catch {
      return null;
    }
  }, []);

  const connectVideoElement = useCallback((vid: HTMLVideoElement) => {
    const ctx = getOrCreateContext();
    if (!ctx || !preAnalyserRef.current) return;

    // Idempotent guard — same element already wired into this graph.
    // MediaElementAudioSourceNode persists across src changes so the existing
    // node continues to route audio when the clip changes.  Re-calling
    // createMediaElementSource on an already-connected element throws
    // InvalidStateError, so we must skip if nothing has changed.
    //
    // ── M1 fix ────────────────────────────────────────────────────────────
    // This guard is now the ONLY gate on createMediaElementSource for this
    // element anywhere in the app. use-signal-diagnostics no longer calls
    // createMediaElementSource at all — it consumes diagnosticsAnalyserRef
    // from this hook instead. See migration note at bottom of this file.
    if (connectedElementRef.current === vid) return;

    // Safe-Bridge Check — use getAttribute (DOM attribute) not the IDL
    // property.  createMediaElementSource on a cross-origin element that lacks
    // the crossorigin attribute does NOT throw; it silently returns a 0-channel
    // source AND suppresses the element's native audio track → complete silence.
    // Archive.org and CDN clips must stay on the native path when the CORS
    // handshake isn't possible.  Native audio is set-and-forget: vid.volume /
    // vid.muted continue to work without Web Audio ownership.
    const crossoriginAttr = vid.getAttribute('crossorigin');
    const hasCORSAttr = crossoriginAttr === 'anonymous' || crossoriginAttr === 'use-credentials';
    if (!hasCORSAttr) {
      connectedElementRef.current = vid; // prevent re-entry for same element
      setDiagnosticsReady(false); // no source bridged → diagnostics tap has no signal either
      console.log("[AudioBridge] ⚠ BYPASSING bridge for non-CORS source. Using native audio path.");
      fetch("/api/watchdog/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "AUDIO_NATIVE_FALLBACK",
          ctxState: ctx.state,
          crossOrigin: crossoriginAttr ?? "none",
          src: vid.src?.slice(0, 120),
          ts: Date.now(),
        }),
      }).catch(() => {});
      return;
    }

    // Disconnect the previous source node only — the preAnalyser→gainNode→destination
    // and preAnalyser→diagnosticsAnalyser edges were established once during
    // context creation and must not be reconnected.
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.disconnect(); } catch {}
      sourceNodeRef.current = null;
    }

    try {
      const source = ctx.createMediaElementSource(vid);
      source.connect(preAnalyserRef.current);
      sourceNodeRef.current = source;
      connectedElementRef.current = vid;
      console.log("[audio-norm] connectVideoElement: bridged to Web Audio graph ✓");
      // Latch: gates frame-capture tool — set once, never reset within the session
      bridgeReadyRef.current = true;
      setBridgeReady(true);
      setDiagnosticsReady(true); // diagnosticsAnalyser now has a live signal upstream
      // Server telemetry so we can confirm bridge status in the workflow logs
      fetch("/api/watchdog/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "AUDIO_BRIDGE_OK",
          ctxState: ctx.state,
          crossOrigin: vid.crossOrigin,
          src: vid.src?.slice(0, 120),
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
          crossOrigin: vid.crossOrigin,
          src: vid.src?.slice(0, 120),
          ts: Date.now(),
        }),
      }).catch(() => {});
    }
  }, [getOrCreateContext]);

  // ── vMix AudioContext resume with retry backoff ───────────────────────────
  // vMix's embedded Chromium can:
  //   1. Accept resume() but delay the "running" state transition by >400ms.
  //   2. Return the context to "suspended" / "interrupted" after a routing change.
  //   3. Silently ignore a resume() call made before the page is focused.
  // A single resume() call is not enough.  We retry up to MAX_RESUME_ATTEMPTS
  // times at RESUME_RETRY_MS intervals so the context becomes "running" even
  // when the state transition is slow or a second gesture is needed.
  const resumeRetryCountRef = useRef(0);
  const MAX_RESUME_ATTEMPTS = 6;
  const RESUME_RETRY_MS    = 400;

  const resumeAudioContext = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    const activation = (navigator as unknown as { userActivation?: { isActive: boolean; hasBeenActive: boolean } }).userActivation;
    console.log(
      `[AudioContext] resume attempt — state=${ctx.state}` +
      (activation ? ` userActivation.isActive=${activation.isActive} hasBeenActive=${activation.hasBeenActive}` : "")
    );

    // ── vMix Audio Latch: handle both "suspended" AND "interrupted" ───────────
    // vMix's embedded Chromium can put the AudioContext into "interrupted" state
    // (a browser-specific extension of the Web Audio API spec used on iOS/vMix)
    // in addition to the standard "suspended" state.  Checking only "suspended"
    // means the resume is silently skipped on vMix, leaving meters at 0.0.
    if (ctx.state !== "running") {
      resumeRetryCountRef.current = 0;

      const attemptResume = () => {
        const c = audioCtxRef.current;
        if (!c || c.state === "running") return;
        if (resumeRetryCountRef.current >= MAX_RESUME_ATTEMPTS) {
          console.warn(`[AudioContext] Gave up after ${MAX_RESUME_ATTEMPTS} resume attempts — state=${c.state}. A user gesture inside the vMix browser input is required.`);
          return;
        }
        resumeRetryCountRef.current += 1;
        c.resume()
          .then(() => {
            if (c.state === "running") {
              console.log(`[AudioContext] Running OK after ${resumeRetryCountRef.current} attempt(s).`);
            } else {
              console.log(`[AudioContext] resume() resolved but state=${c.state} — retry ${resumeRetryCountRef.current}/${MAX_RESUME_ATTEMPTS} in ${RESUME_RETRY_MS}ms`);
              setTimeout(attemptResume, RESUME_RETRY_MS);
            }
          })
          .catch((err: unknown) => {
            const e = err as DOMException | Error | null;
            console.warn(`[AudioContext] resume() rejected (attempt ${resumeRetryCountRef.current}) — name="${(e as DOMException)?.name}" msg="${(e as Error)?.message}" state=${c.state}`);
            setTimeout(attemptResume, RESUME_RETRY_MS);
          });
      };

      attemptResume();
    }
  }, []);

  const applyGain = useCallback((db: number, ramp = false) => {
    const gainNode = gainNodeRef.current;
    const ctx = audioCtxRef.current;
    if (!gainNode || !ctx) {
      console.debug("[audio-norm] applyGain: gainNode or ctx missing", { hasGainNode: !!gainNode, hasCtx: !!ctx });
      return;
    }
    const linearVal = dbToLinear(db);
    if (ramp) {
      gainNode.gain.linearRampToValueAtTime(linearVal, ctx.currentTime + RAMP_DURATION_S);
    } else {
      gainNode.gain.setValueAtTime(linearVal, ctx.currentTime);
    }
    console.debug("[audio-norm] gain applied:", { db, linearVal, ramp });
  }, []);

  // ── Single Master Fader ───────────────────────────────────────────────────
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

  // Shared sampling logic — declared before setGainDb and setAutoNormalize so
  // both can reference it without forward-reference errors.
  const startNormalizationSampling = useCallback(() => {
    const analyser = preAnalyserRef.current;
    const ctx = audioCtxRef.current;
    const gainNode = gainNodeRef.current;
    if (!analyser || !ctx || !gainNode) return;
    if (ctx.state !== "running") return;
    if (samplingActiveRef.current) return;

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
      for (let i = 0; i < bufferLength; i++) {
        ss += dataArray[i] * dataArray[i];
      }
      sumSquares += ss / bufferLength;
      sampleCount++;
    }, 100);

    sampleTimerRef.current = setTimeout(() => {
      samplingActiveRef.current = false;
      clearInterval(sampleIntervalRef.current);
      if (!autoNormalizeRef.current) return;
      if (sampleCount === 0) return;

      const rms = Math.sqrt(sumSquares / sampleCount);
      if (rms < 1e-6) return;

      const rawDb = linearToDb(rms);
      const compensationDb = TARGET_DBFS - rawDb;
      const totalDb = Math.max(DB_MIN, Math.min(DB_MAX, gainDbRef.current + compensationDb));

      gainNode.gain.linearRampToValueAtTime(
        dbToLinear(totalDb),
        ctx.currentTime + RAMP_DURATION_S,
      );
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
    const vid = videoRef.current;
    if (!vid) return;

    const ctx = getOrCreateContext();
    if (!ctx) return;
    let attached = false;

    const doConnect = () => {
      connectVideoElement(vid);
      attached = true;
    };

    if (ctx.state === "running") {
      doConnect();
      return;
    }

    const onStateChange = () => {
      if ((ctx.state as string) === "running") {
        doConnect();
      }
    };
    ctx.addEventListener("statechange", onStateChange);
    resumeAudioContext();
    if ((ctx.state as string) === "running") {
      doConnect();
    }
    return () => {
      ctx.removeEventListener("statechange", onStateChange);
      if (!attached) {
        console.debug("[audio-norm] bridge cleanup before attachment");
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerType, clipKey, connectVideoElement, resumeAudioContext, getOrCreateContext]);

  useEffect(() => {
    if (!autoNormalize) return;
    if (playerType !== "video" && playerType !== "hls") return;
    const vid = videoRef.current;
    if (!vid) return;
    connectVideoElement(vid);
    const onPlaying = () => startNormalizationSampling();
    vid.addEventListener("playing", onPlaying);
    return () => vid.removeEventListener("playing", onPlaying);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoNormalize, playerType, clipKey, connectVideoElement, startNormalizationSampling]);

  useEffect(() => {
    const handleGesture = () => {
      const ctx = audioCtxRef.current;
      if (ctx && ctx.state !== "running") {
        resumeAudioContext();
      }
    };
    document.addEventListener("click",    handleGesture, { passive: true });
    document.addEventListener("keydown",  handleGesture, { passive: true });
    document.addEventListener("pointerup", handleGesture, { passive: true });
    return () => {
      document.removeEventListener("click",    handleGesture);
      document.removeEventListener("keydown",  handleGesture);
      document.removeEventListener("pointerup", handleGesture);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      samplingActiveRef.current = false;
      clearTimeout(sampleTimerRef.current);
      clearInterval(sampleIntervalRef.current);
    };
  }, []);

  const primeAudioContext = useCallback(() => {
    getOrCreateContext();
    resumeAudioContext();
    console.log("[AudioPrime] Context created + resume initiated on mount");
  }, [getOrCreateContext, resumeAudioContext]);

  return {
    gainDb,
    setGainDb,
    autoNormalize,
    setAutoNormalize,
    audioContextSuspended,
    resumeAudioContext,
    primeAudioContext,
    setMasterVolume,
    bridgeReady,
    preAnalyserRef,
    audioCtxRef,
    diagnosticsAnalyserRef,
    diagnosticsReady,
  };
}
