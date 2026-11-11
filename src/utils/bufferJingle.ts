// Buffering jingle: a short looping bed that plays under the "waiting room" while the player is REALLY waiting.
// Pure controller (no React, no globals) so timing is testable. It never fakes success: if the browser refuses
// to play or the file is missing, it stays silent and the real status text carries on.
export const JINGLE_SRC = '/audio/ajn-interstitial-jingle.mp3';
export const JINGLE_MAX_MS = 30_000;
export const JINGLE_FADE_IN_MS = 250;
export const JINGLE_FADE_OUT_MS = 500;
export const JINGLE_VOLUME = 0.35;
export const JINGLE_PREF_KEY = 'ajn.bufferJingle';
export const JINGLE_FADE_KEY = 'ajn.bufferJingle.fadeMs';
export const JINGLE_TITLE = 'The Quiet Between';
const STEP_MS = 25;

export interface JingleAudio { volume: number; loop: boolean; currentTime: number; play(): Promise<void> | void; pause(): void }
export interface JingleTimers { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void; setEvery: (fn: () => void, ms: number) => unknown; clearEvery: (h: unknown) => void }
/** Fade-out length. Default 500 ms; a listener/tester can set localStorage ajn.bufferJingle.fadeMs (0-5000) to try other lengths without a rebuild. */
export function jingleFadeMs(storage: Pick<Storage, 'getItem'> | null): number {
  try { const n = Number(storage?.getItem(JINGLE_FADE_KEY)); return Number.isFinite(n) && n >= 0 && n <= 5000 && storage?.getItem(JINGLE_FADE_KEY) !== null && storage?.getItem(JINGLE_FADE_KEY) !== '' ? n : JINGLE_FADE_OUT_MS; } catch { return JINGLE_FADE_OUT_MS; }
}

export interface JingleController { start(): void; stop(): void; stopNow(): void; readonly active: boolean; readonly timedOut: boolean }

export const realTimers: JingleTimers = {
  set: (fn, ms) => window.setTimeout(fn, ms), clear: (h) => window.clearTimeout(h as number),
  setEvery: (fn, ms) => window.setInterval(fn, ms), clearEvery: (h) => window.clearInterval(h as number),
};

/** On unless the listener turned it off (localStorage ajn.bufferJingle = "off"). */
export function jingleEnabled(storage: Pick<Storage, 'getItem'> | null): boolean {
  try { return storage?.getItem(JINGLE_PREF_KEY) !== 'off'; } catch { return true; }
}

export function createJingleController(audio: JingleAudio, timers: JingleTimers = realTimers, opts: { maxMs?: number; fadeInMs?: number; fadeOutMs?: number; volume?: number; onActive?: (active: boolean) => void } = {}): JingleController {
  const maxMs = opts.maxMs ?? JINGLE_MAX_MS, fadeInMs = opts.fadeInMs ?? JINGLE_FADE_IN_MS, fadeOutMs = opts.fadeOutMs ?? JINGLE_FADE_OUT_MS, vol = opts.volume ?? JINGLE_VOLUME;
  let active = false, timedOut = false, cap: unknown = null, ramp: unknown = null;
  const clearRamp = (): void => { if (ramp !== null) { timers.clearEvery(ramp); ramp = null; } };
  const clearCap = (): void => { if (cap !== null) { timers.clear(cap); cap = null; } };
  const rampTo = (target: number, ms: number, done?: () => void): void => {
    clearRamp();
    const from = audio.volume; const steps = Math.max(1, Math.round(ms / STEP_MS)); let i = 0;
    ramp = timers.setEvery(() => { i += 1; audio.volume = Math.max(0, Math.min(1, from + ((target - from) * i) / steps)); if (i >= steps) { clearRamp(); done?.(); } }, STEP_MS);
  };
  const halt = (): void => { clearRamp(); clearCap(); audio.pause(); audio.currentTime = 0; audio.volume = 0; const was = active; active = false; if (was) opts.onActive?.(false); };
  return {
    get active() { return active; }, get timedOut() { return timedOut; },
    start() {
      if (active || timedOut) return;
      active = true; opts.onActive?.(true); audio.loop = true; audio.currentTime = 0; audio.volume = 0;
      let p: Promise<void> | void;
      try { p = audio.play(); } catch { halt(); return; }
      if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => { halt(); }); // autoplay blocked / file missing: stay silent
      rampTo(vol, fadeInMs);
      cap = timers.set(() => { timedOut = true; this.stop(); }, maxMs);
    },
    stop() { if (!active) return; clearCap(); rampTo(0, fadeOutMs, halt); },
    stopNow() { halt(); },
  };
}
