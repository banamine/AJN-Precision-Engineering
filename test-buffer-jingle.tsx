import assert from 'node:assert/strict';
import { createJingleController, jingleEnabled, JINGLE_MAX_MS, JINGLE_VOLUME, type JingleAudio, type JingleTimers } from './src/utils/bufferJingle';
// Manual clock so timing is exact.
function clock() {
  let now = 0; let id = 0; const timeouts = new Map<number, { at: number; fn: () => void }>(); const intervals = new Map<number, { every: number; next: number; fn: () => void }>();
  const timers: JingleTimers = {
    set: (fn, ms) => { id += 1; timeouts.set(id, { at: now + ms, fn }); return id; }, clear: (h) => { timeouts.delete(h as number); },
    setEvery: (fn, ms) => { id += 1; intervals.set(id, { every: ms, next: now + ms, fn }); return id; }, clearEvery: (h) => { intervals.delete(h as number); },
  };
  const advance = (ms: number): void => {
    const end = now + ms;
    for (;;) {
      const t = [...timeouts.values()].map((x) => x.at); const i = [...intervals.values()].map((x) => x.next);
      const nxt = Math.min(...t, ...i, Infinity); if (nxt > end) break; now = nxt;
      for (const [k, v] of [...timeouts]) if (v.at <= now) { timeouts.delete(k); v.fn(); }
      for (const v of [...intervals.values()]) if (v.next <= now) { v.next += v.every; v.fn(); }
    }
    now = end;
  };
  return { timers, advance, pending: () => timeouts.size + intervals.size };
}
function fakeAudio(opts: { rejectPlay?: boolean } = {}): JingleAudio & { plays: number; paused: boolean } {
  const a = { volume: 0, loop: false, currentTime: 12, plays: 0, paused: true, play() { a.plays += 1; a.paused = false; return opts.rejectPlay ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve(); }, pause() { a.paused = true; } };
  return a;
}
{ // starts looping at 0, fades in, then fades out and halts when the wait ends
  const c = clock(); const a = fakeAudio(); const j = createJingleController(a, c.timers);
  j.start(); assert.equal(a.loop, true); assert.equal(a.currentTime, 0); assert.equal(a.plays, 1); assert.equal(a.volume, 0);
  c.advance(250); assert.ok(Math.abs(a.volume - JINGLE_VOLUME) < 1e-9, `faded in: ${a.volume}`);
  j.start(); assert.equal(a.plays, 1, 'second start while active is ignored');
  c.advance(5000); j.stop(); c.advance(250); assert.ok(a.volume > 0 && a.volume < JINGLE_VOLUME, 'mid fade-out'); assert.equal(a.paused, false);
  c.advance(300); assert.equal(a.paused, true); assert.equal(a.volume, 0); assert.equal(j.active, false); assert.equal(c.pending(), 0, 'no timers left behind');
}
{ // strict 30 s ceiling, then fades out and does not restart in the same wait
  const c = clock(); const a = fakeAudio(); const j = createJingleController(a, c.timers);
  j.start(); c.advance(JINGLE_MAX_MS - 1); assert.equal(a.paused, false); c.advance(1); c.advance(600);
  assert.equal(a.paused, true); assert.equal(j.timedOut, true); j.start(); assert.equal(a.plays, 1, 'no restart after timeout'); assert.equal(c.pending(), 0);
}
{ // autoplay refused / file missing: silent, inactive, nothing pending
  const c = clock(); const a = fakeAudio({ rejectPlay: true }); const j = createJingleController(a, c.timers);
  j.start(); await Promise.resolve(); await Promise.resolve(); assert.equal(j.active, false); assert.equal(a.paused, true); assert.equal(c.pending(), 0);
}
{ // stop without start is a no-op; stopNow halts immediately
  const c = clock(); const a = fakeAudio(); const j = createJingleController(a, c.timers); j.stop(); assert.equal(a.plays, 0);
  j.start(); c.advance(100); j.stopNow(); assert.equal(a.paused, true); assert.equal(a.volume, 0); assert.equal(c.pending(), 0);
}
assert.equal(jingleEnabled({ getItem: () => 'off' }), false); assert.equal(jingleEnabled({ getItem: () => null }), true); assert.equal(jingleEnabled(null), true);
assert.equal(jingleEnabled({ getItem: () => { throw new Error('blocked'); } }), true);
// BufferJingle renders nothing and is wired to the real wait status
import { renderToStaticMarkup } from 'react-dom/server';
import { BufferJingle } from './src/components/BufferJingle';
assert.equal(renderToStaticMarkup(<BufferJingle status="Buffering…" enabled />), '');
console.log('buffer-jingle ok');
