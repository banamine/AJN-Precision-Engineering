import { useEffect, useRef } from 'react';
import notesJson from '../data/waitingNotes.json';
import { waitKindOf } from '../utils/waitingNotes';
import { JINGLE_SRC, createJingleController, jingleEnabled, type JingleController } from '../utils/bufferJingle';

const SHOW_AFTER_MS = (notesJson as { settings: { showAfterMs: number } }).settings.showAfterMs;

/** Plays the looping jingle under the waiting-room display, starting when the waiting-room display appears and fading out when the status stops being a wait.
 *  Driven by the same real status text as <WaitingNotes>. Video only (live radio keeps its own sound). Renders nothing. */
export function BufferJingle({ status, enabled }: { status: string; enabled: boolean }): null {
  const waiting = waitKindOf(status) !== null;
  const ctl = useRef<JingleController | null>(null);
  useEffect(() => {
    if (!enabled || typeof Audio === 'undefined' || !jingleEnabled(typeof localStorage === 'undefined' ? null : localStorage)) return undefined;
    const audio = new Audio(JINGLE_SRC); audio.preload = 'auto'; audio.volume = 0;
    ctl.current = createJingleController(audio);
    return () => { ctl.current?.stopNow(); ctl.current = null; };
  }, [enabled]);
  useEffect(() => {
    const c = ctl.current; if (!c || !waiting) return undefined;
    const t = window.setTimeout(() => c.start(), SHOW_AFTER_MS); // same delay as the waiting room, so quick loads never hear it
    return () => { window.clearTimeout(t); c.stop(); };
  }, [waiting, enabled]);
  return null;
}
