import { useCallback, useEffect, useRef, useState } from 'react';
import { SKIP_RATE, SilenceSkipper, compensateDb, loadSkipSetting, saveSkipSetting } from '../utils/silenceSkip';
import { rmsDb } from '../onair/loudness';

export type SilenceSkipState = 'hidden' | 'unreadable' | 'off' | 'on';
export interface SilenceSkipApi { state: SilenceSkipState; savedSec: number; toggle: () => void }
const TICK_MS = 50;

/** `eligible`: spoken on-demand audio (a podcast). `readable`: the analyser can really hear this source. Hidden otherwise; "unreadable" is shown disabled with the reason. */
export function useSilenceSkip(getMedia: () => HTMLMediaElement | null, analyser: AnalyserNode | null, eligible: boolean, readable: boolean, resetKey: string): SilenceSkipApi {
  const [on, setOn] = useState<boolean>(() => loadSkipSetting());
  const [savedSec, setSavedSec] = useState(0);
  const savedRef = useRef(0);
  useEffect(() => { savedRef.current = 0; setSavedSec(0); }, [resetKey]);
  const active = on && eligible && readable && Boolean(analyser);

  useEffect(() => {
    if (!active || !analyser) return;
    const skipper = new SilenceSkipper();
    const buf = new Float32Array(analyser.fftSize);
    let lastMs = performance.now(), lastShown = 0, wasActive = false;
    const restore = (m: HTMLMediaElement | null) => { const r = skipper.release(); if (r !== null && m) { try { m.playbackRate = r; } catch { /* ignore */ } } };
    const id = window.setInterval(() => {
      const m = getMedia(); const now = performance.now(); const dt = now - lastMs; lastMs = now;
      if (!m) return;
      if (m.paused || m.seeking || m.ended) { restore(m); return; }
      analyser.getFloatTimeDomainData(buf);
      const db = compensateDb(rmsDb(buf), m.volume);
      const rate = skipper.step({ db, nowMs: now, position: m.currentTime, duration: m.duration, rate: m.playbackRate, ready: m.readyState >= 3, muted: m.muted });
      if (rate !== null) { try { m.playbackRate = rate; } catch { /* ignore */ } }
      if (wasActive && !skipper.active) setSavedSec(Math.floor(savedRef.current)); // a pause just ended: show the total now
      wasActive = skipper.active;
      if (skipper.active) { savedRef.current += (dt / 1000) * (SKIP_RATE - 1); if (now - lastShown > 1000) { lastShown = now; setSavedSec(Math.floor(savedRef.current)); } }
    }, TICK_MS);
    return () => { window.clearInterval(id); restore(getMedia()); };
  }, [active, analyser, getMedia]);

  const toggle = useCallback(() => setOn((v) => { saveSkipSetting(!v); return !v; }), []);
  const state: SilenceSkipState = !eligible ? 'hidden' : !readable || !analyser ? 'unreadable' : on ? 'on' : 'off';
  return { state, savedSec, toggle };
}
