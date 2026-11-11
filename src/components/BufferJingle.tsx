import { useEffect, useRef, type ReactElement } from 'react';
import notesJson from '../data/waitingNotes.json';
import { waitKindOf } from '../utils/waitingNotes';
import { JINGLE_SRC, JINGLE_TITLE, createJingleController, jingleFadeMs, type JingleController } from '../utils/bufferJingle';
import { jingleStore, useJingle } from '../utils/jingleStore';

const SHOW_AFTER_MS = (notesJson as { settings: { showAfterMs: number } }).settings.showAfterMs;

/** Plays the looping jingle under the waiting room, starting when the waiting-room display appears and fading out when the status stops being a wait.
 *  Driven by the same real status text as <WaitingNotes>. Video only (live radio keeps its own sound). Renders nothing. */
export function BufferJingle({ status, enabled }: { status: string; enabled: boolean }): null {
  const waiting = waitKindOf(status) !== null;
  const { on } = useJingle();
  const ctl = useRef<JingleController | null>(null);
  const waitStart = useRef<number | null>(null);
  useEffect(() => { waitStart.current = waiting ? Date.now() : null; }, [waiting]);
  useEffect(() => {
    jingleStore.setSupported(enabled);
    if (!enabled || !on || typeof Audio === 'undefined') return () => { jingleStore.setSupported(false); };
    const audio = new Audio(JINGLE_SRC); audio.preload = 'auto'; audio.volume = 0;
    ctl.current = createJingleController(audio, undefined, { fadeOutMs: jingleFadeMs(typeof localStorage === 'undefined' ? null : localStorage), onActive: jingleStore.setPlaying });
    return () => { ctl.current?.stopNow(); ctl.current = null; jingleStore.setSupported(false); };
  }, [enabled, on]);
  useEffect(() => {
    const c = ctl.current; if (!c || !waiting) return undefined;
    const elapsed = waitStart.current === null ? 0 : Date.now() - waitStart.current;
    const t = window.setTimeout(() => c.start(), Math.max(0, SHOW_AFTER_MS - elapsed)); // same delay as the waiting room, so quick loads never hear it
    return () => { window.clearTimeout(t); c.stop(); };
  }, [waiting, enabled, on]);
  return null;
}

/** Shown inside the waiting room (video waits only): what is playing, and a sound on/off key. */
export function JingleChip(): ReactElement | null {
  const { supported, playing, on } = useJingle();
  if (!supported) return null;
  return (
    <div data-testid="jingle-chip" className="mt-1.5 flex items-center gap-2 text-[11px] text-neutral-300">
      <span aria-hidden="true" className={playing ? 'text-amber-300' : 'text-neutral-500'}>♪</span>
      <span className="min-w-0 flex-1 truncate" data-testid="jingle-chip-label">{playing ? `Now playing: ${JINGLE_TITLE}` : on ? 'Waiting-room music on' : 'Waiting-room music off'}</span>
      <button type="button" data-testid="jingle-toggle" aria-pressed={on} onClick={() => jingleStore.setOn(!on)} className="ck-key ck-key--sm !min-h-[32px] px-2 text-[10px]">{on ? 'Sound off' : 'Sound on'}</button>
    </div>
  );
}
