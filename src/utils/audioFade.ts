/** Volume ramps for audio track changes (smooth fade-out of the old track, fade-in of the next). Pure and clock-injectable so it can be tested. */
export interface FadeTarget { volume: number }
export interface FadeClock { now(): number; request(cb: () => void): unknown; cancel(handle: unknown): void }

export const AUDIO_FADE_OUT_MS = 300;
export const AUDIO_FADE_IN_MS = 700;

const realClock: FadeClock = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  request: (cb) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : setTimeout(cb, 16)),
  cancel: (h) => { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(h as number); else clearTimeout(h as ReturnType<typeof setTimeout>); },
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

/** Ramp `el.volume` from its current value to `to` over `ms`. Returns a cancel function (the volume stays where it was). */
export function rampVolume(el: FadeTarget, to: number, ms: number, onDone?: () => void, clock: FadeClock = realClock): () => void {
  const from = clamp01(el.volume), target = clamp01(to);
  if (ms <= 0 || from === target) { el.volume = target; onDone?.(); return () => {}; }
  const start = clock.now();
  let handle: unknown = null, cancelled = false;
  const tick = () => {
    if (cancelled) return;
    const p = Math.min(1, (clock.now() - start) / ms);
    el.volume = clamp01(from + (target - from) * p);
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
