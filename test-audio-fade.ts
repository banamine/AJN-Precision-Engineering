import { curveFraction, FADE_TABLE, fadeInElement, rampVolume, shouldFadeOut, audioFadeEnabled, type FadeClock } from './src/utils/audioFade';
let fails = 0; const ok = (c: boolean, m: string) => { console.log(`${c ? 'ok' : 'FAIL'} - ${m}`); if (!c) fails++; };
let t = 0; const q: Array<() => void> = [];
const clock: FadeClock = { now: () => t, request: (cb) => { q.push(cb); return q.length; }, cancel: () => { q.length = 0; } };
const step = (ms: number) => { t += ms; const cb = q.shift(); cb?.(); };
const el = { volume: 1 }; let done = false;
rampVolume(el, 0, 300, () => { done = true; }, clock);
step(150); ok(Math.abs(el.volume - 0.5) < 1e-9, 'halfway = 0.5');
step(150); ok(el.volume === 0 && done, 'ends at 0 and calls onDone');
const e2 = { volume: 0 }; const cancel = rampVolume(e2, 1, 700, undefined, clock); step(350); cancel(); const v = e2.volume; step(350);
ok(v > 0.4 && v < 0.6 && e2.volume === v, 'cancel freezes the volume');
const e3 = { volume: 0.5 }; let d3 = false; rampVolume(e3, 0.5, 300, () => { d3 = true; }, clock); ok(d3, 'no-op ramp finishes at once');
const playing = { paused: false, ended: false, currentTime: 12, volume: 1, muted: false };
ok(shouldFadeOut(playing, true, true, 'b', 'a'), 'fades a playing audio track');
ok(!shouldFadeOut({ ...playing, paused: true }, true, true, 'b', 'a'), 'no fade when paused');
ok(!shouldFadeOut({ ...playing, ended: true }, true, true, 'b', 'a'), 'no fade when the track ended');
ok(!shouldFadeOut({ ...playing, muted: true }, true, true, 'b', 'a'), 'no fade when muted');
ok(!shouldFadeOut(playing, true, true, 'a', 'a'), 'no fade for the same source');
ok(!shouldFadeOut(playing, true, false, 'b', 'a'), 'no fade when the next item is video');
ok(!shouldFadeOut(null, false, true, 'b', 'a'), 'no fade without an element');
ok(!audioFadeEnabled({ getItem: () => 'off' }) && audioFadeEnabled({ getItem: () => null }), 'opt-out flag works');

// ── curves, table, fadeInElement (Phase 2)
{
  const near = (a: number, b: number) => ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  for (const p of [0, 0.25, 0.5, 0.75, 1]) { const r = curveFraction(p, 'equal-power', true), f = curveFraction(1 - p, 'equal-power', true); near(r * r + f * f, 1); } // crossfade: constant power
  near(curveFraction(0.5, 's-curve', true), 0.5); ok(curveFraction(0.1, 's-curve', true) < 0.1, 'S-curve eases in');
  ok(FADE_TABLE.declick.ms === 8 && FADE_TABLE.speech.ms >= 300 && FADE_TABLE.speech.ms <= 800 && FADE_TABLE.music.ms >= 2000 && FADE_TABLE.bed.ms >= 5000, 'table matches the plan');
  let t = 0; const clock: FadeClock = { now: () => t, request: (cb) => { pending = cb; return 1; }, cancel: () => { pending = null; } }; let pending: (() => void) | null = null;
  const step = (ms: number) => { t += ms; const cb = pending; pending = null; cb?.(); };
  const el = { volume: 0.4, muted: false };
  fadeInElement(el, 'speech', clock); ok(el.volume === 0, 'starts silent'); step(250); ok(el.volume > 0 && el.volume < 0.4, 'rising'); step(300); near(el.volume, 0.4); ok(pending === null, 'ends at the listener level');
  // the listener moves the slider mid-fade: the fade stops and their value stands
  t = 0; const el2 = { volume: 0.5, muted: false }; fadeInElement(el2, 'music', clock); step(500); el2.volume = 0.2; step(100); step(100); near(el2.volume, 0.2); ok(pending === null, 'fade yields');
  // read-only volume (iOS): no fade, level kept
  const ro = { get volume() { return 0.6; }, set volume(_v: number) { /* ignored */ }, muted: false }; fadeInElement(ro, 'speech', clock); near(ro.volume, 0.6);
  // muted / silent: untouched
  const m = { volume: 0.7, muted: true }; fadeInElement(m, 'speech', clock); near(m.volume, 0.7);
  console.log('audio fade curves ok');
}
process.exit(fails ? 1 : 0);
