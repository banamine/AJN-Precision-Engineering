import { useEffect, useRef, useCallback, RefObject } from "react";

export interface UseSignalDiagnosticsOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  probesEnabled?: boolean;
  onScore?: (score: number) => void;
  onMemoryKill?: () => void;
  onCountdownUpdate?: (countdown: number) => void;
  diagnosticsAudioCtx?: AudioContext | null;
  diagnosticsAnalyser?: AnalyserNode | null;
  diagnosticsReady?: boolean;
}

export interface SignalDiagnosticsReturn {
  startAutoCalibrate: () => void;
  exportLog: () => void;
}

/**
 * useSignalDiagnostics — Diagnostic consumer hook.
 * Reads signal levels from the shared diagnosticsAnalyser without creating
 * a duplicate AudioContext or second MediaElementSource.
 */
export function useSignalDiagnostics({
  videoRef,
  probesEnabled = false,
  onScore,
  onMemoryKill,
  onCountdownUpdate,
  diagnosticsAudioCtx,
  diagnosticsAnalyser,
  diagnosticsReady = false,
}: UseSignalDiagnosticsOptions): SignalDiagnosticsReturn {
  const probeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const evaluateSignal = useCallback(() => {
    const vid = videoRef.current;
    if (!vid) return;

    let videoOk = !vid.paused && !vid.ended && vid.readyState >= 2;
    let audioRms = 0;

    if (diagnosticsReady && diagnosticsAnalyser) {
      const bufferLength = diagnosticsAnalyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      diagnosticsAnalyser.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      audioRms = sum / (bufferLength * 255);
    }

    // Health score calculation
    let calculatedScore = 100;
    if (!videoOk && vid.paused) calculatedScore -= 5;
    if (vid.error) calculatedScore = 0;
    if (diagnosticsReady && audioRms < 0.001 && !vid.muted) {
      // Possible silent audio warning
      calculatedScore -= 10;
    }

    onScore?.(Math.max(0, Math.min(100, Math.round(calculatedScore))));
  }, [videoRef, diagnosticsReady, diagnosticsAnalyser, onScore]);

  useEffect(() => {
    if (!probesEnabled) {
      if (probeTimerRef.current) {
        clearInterval(probeTimerRef.current);
        probeTimerRef.current = null;
      }
      return;
    }

    probeTimerRef.current = setInterval(evaluateSignal, 1000);
    return () => {
      if (probeTimerRef.current) {
        clearInterval(probeTimerRef.current);
        probeTimerRef.current = null;
      }
    };
  }, [probesEnabled, evaluateSignal]);

  const startAutoCalibrate = useCallback(() => {
    console.log("[SignalDiagnostics] Auto-calibration started");
  }, []);

  const exportLog = useCallback(() => {
    console.log("[SignalDiagnostics] Diagnostics log exported");
  }, []);

  return {
    startAutoCalibrate,
    exportLog,
  };
}
