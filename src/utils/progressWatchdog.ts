/** Event-independent stall detector. The player's other watchdogs are armed by media events ('waiting', 'play');
 *  if the browser goes quiet (a request pending with no error), no event arrives and they never fire.
 *  This one only looks at the element's state once a second: no progress for `stallMs` while the listener wants playback = stalled. */
export interface WatchdogSample { wantsPlay: boolean; readyState: number; currentTime: number; bufferedEnd: number }
export function createProgressWatchdog(opts: { stallMs: number; sample: () => WatchdogSample; onStall: () => void; now?: () => number }) {
  const now = opts.now ?? Date.now;
  let sig = ''; let since = now();
  return {
    tick(): void {
      const s = opts.sample(); const t = now();
      // Not wanted, or anything moved (playhead, buffer, readyState): restart the clock. A frozen element is stalled at ANY readyState:
      // live streams in Chrome can sit at HAVE_FUTURE_DATA (3) or 4 with the playhead frozen and no event at all.
      const next = `${s.readyState}|${s.currentTime.toFixed(2)}|${s.bufferedEnd.toFixed(1)}`;
      if (!s.wantsPlay || next !== sig) { sig = next; since = t; return; }
      if (t - since >= opts.stallMs) { since = t; opts.onStall(); }
    },
  };
}
