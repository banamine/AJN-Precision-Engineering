/* Decides what a keydown means for the player. Pure so it can be tested without a browser.
 * Rules: never with Ctrl/Alt/Meta (browser/OS shortcuts win); never while typing; Space/Enter on a focused button or link is left to
 * that control (native click) — but M, F and the arrows still work there, so clicking a player button doesn't kill the shortcuts. */
export type PlayerKeyAction = 'toggle-play' | 'toggle-mute' | 'fullscreen' | 'seek-back' | 'seek-forward' | 'volume-up' | 'volume-down';
export const SEEK_STEP_SECONDS = 10;
export const SEEK_STEP_LONG_SECONDS = 30;

export interface KeyInfo { key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean; shiftKey: boolean; targetTag?: string; targetType?: string; editable?: boolean; defaultPrevented?: boolean }

export function playerKeyAction(k: KeyInfo): PlayerKeyAction | null {
  if (k.defaultPrevented || k.ctrlKey || k.altKey || k.metaKey) return null;
  const tag = (k.targetTag ?? '').toUpperCase();
  if (k.editable || tag === 'TEXTAREA' || tag === 'SELECT') return null;
  if (tag === 'INPUT') return null; // text fields, and range sliders which own the arrow keys
  const onControl = tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY';
  switch (k.key) {
    case ' ': case 'Spacebar': return onControl ? null : 'toggle-play';
    case 'k': case 'K': return k.shiftKey ? null : 'toggle-play';
    case 'm': case 'M': return 'toggle-mute';
    case 'f': case 'F': return 'fullscreen';
    case 'ArrowLeft': return 'seek-back';
    case 'ArrowRight': return 'seek-forward';
    case 'ArrowUp': return 'volume-up';
    case 'ArrowDown': return 'volume-down';
    case 'j': case 'J': return 'seek-back';
    case 'l': case 'L': return 'seek-forward';
    default: return null;
  }
}
/** Arrow = 10 s (unchanged from before); Shift+Arrow or J/L = 30 s. */
export function seekDelta(action: 'seek-back' | 'seek-forward', key: string, shiftKey: boolean): number {
  const long = shiftKey || key.toLowerCase() === 'j' || key.toLowerCase() === 'l';
  const s = long ? SEEK_STEP_LONG_SECONDS : SEEK_STEP_SECONDS;
  return action === 'seek-back' ? -s : s;
}
