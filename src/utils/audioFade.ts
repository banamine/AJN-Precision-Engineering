/** Volume ramps for audio track changes (smooth fade-out of the old track, fade-in of the next). Pure and clock-injectable so it can be tested. */
export interface FadeTarget { volume: number }
export interface FadeClock { now(): number; request(cb: () => void): unknown; cancel(handle: unknown): void }

export type FadeCurve = 'linear' | 'equal-power' | 's-curve';
export type FadeKind = 'declick' | 'speech' | 'music' | 'bed';
/** What each kind of audio gets. declick = Web Audio GainNode only (an element's volume updates once per frame, ~16 ms, too coarse for 8 ms). */
export const FADE_TABLE: Record<FadeKind, { ms: number; curve: FadeCurve }> = {
  declick: { ms: 8, curve: 'equal-power' },
  speech: { ms: 500, curve: 'equal-power' },   // tight: intros must not drag
  music: { ms: 3000, curve: 's-curve' },        // eased at both ends
  bed: { ms: 6000, curve: 'equal-power' },      // late-night / background tails
};
/** 0→1 progress mapped through a curve. Equal power: the rising side of a crossfade is sin, the falling side cos, so their POWER always sums to 1. */
export function curveFraction(p: number, curve: FadeCurve, rising: boolean): number {
  const x = Math.max(0, Math.min(1, p));
  if (curve === 's-curve') return x * x * (3 - 2 * x);
  if (curve === 'equal-power') return rising ? Math.sin(x * Math.PI / 2) : 1 - Math.cos(x * Math.PI / 2);
  return x;
}
export const AUDIO_FADE_OUT_MS = 300;
export const AUDIO_FADE_IN_MS = 700;

const realClock: FadeClock = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  request: (cb) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : setTimeout(cb, 16)),
  cancel: (h) => { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(h as number); else clearTimeout(h as ReturnType<typeof setTimeout>); },
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

/** Ramp `el.volume` from its current value to `to` over `ms`. Returns a cancel function (the volume stays where it was). */
export interface RampOptions { curve?: FadeCurve; /** stop (leave the listener's value alone) when the volume was changed by someone else mid-ramp */ yieldToUser?: boolean }
export function rampVolume(el: FadeTarget, to: number, ms: number, onDone?: () => void, clock: FadeClock = realClock, opts: RampOptions = {}): () => void {
  const from = clamp01(el.volume), target = clamp01(to);
  if (ms <= 0 || from === target) { el.volume = target; onDone?.(); return () => {}; }
  const start = clock.now();
  let handle: unknown = null, cancelled = false, written = from;
  const curve = opts.curve ?? 'linear', rising = target >= from;
  const tick = () => {
    if (cancelled) return;
    if (opts.yieldToUser && Math.abs(clamp01(el.volume) - written) > 0.02) { handle = null; return; } // the listener moved the slider: their value stands
    const p = Math.min(1, (clock.now() - start) / ms);
    written = clamp01(from + (target - from) * curveFraction(p, curve, rising));
    el.volume = written;
    if (p >= 1) { handle = null; onDone?.(); return; }
    handle = clock.request(tick);
  };
  handle = clock.request(tick);
  return () => { cancelled = true; if (handle !== null) clock.cancel(handle); };
}

/** Crossfading is on unless the listener switched it off (localStorage `ajn_audio_crossfade` = "off"). */
export function audioFadeEnabled(storage?: Pick<Storage, 'getItem'> | null): boolean {
  try { return (storage ?? (typeof localStorage === 'undefined' ? null : localStorage))?.getItem('ajn_audio_crossfade') !== 'off'; } catch { return true; }
}

/** Fade the OUTGOING track only when something is really audible: a playing audio element with sound, switching to a different source. */
export function shouldFadeOut(prev: { paused: boolean; ended: boolean; currentTime: number; volume: number; muted: boolean } | null | undefined, isAudioElement: boolean, nextIsAudio: boolean, nextSrc: string, currentSrc: string): boolean {
  if (!prev || !isAudioElement || !nextIsAudio || nextSrc === currentSrc) return false;
  return !prev.paused && !prev.ended && prev.currentTime > 0 && !prev.muted && prev.volume > 0.01;
}

/** Fade a freshly created element IN to the volume it already has. Safe by construction: never leaves it silent
 *  (read-only volume such as iOS → no fade; the listener touching the slider ends the fade; the final write is the target). */
export function fadeInElement(el: FadeTarget & { muted?: boolean }, kind: FadeKind, clock: FadeClock = realClock): () => void {
  const { ms, curve } = FADE_TABLE[kind];
  const target = clamp01(el.volume);
  if (ms <= 0 || target <= 0.01 || el.muted) return () => {};
  el.volume = 0;
  if (el.volume !== 0) { el.volume = target; return () => {}; } // volume is read-only here: skip the fade, keep the level
  return rampVolume(el, target, ms, undefined, clock, { curve, yieldToUser: true });
}
