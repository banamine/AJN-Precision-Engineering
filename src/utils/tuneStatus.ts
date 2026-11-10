export type TuneStatus =
  | { kind: 'idle' }
  | { kind: 'tuning'; label: string }
  | { kind: 'slow'; label: string }
  | { kind: 'playing'; label: string }
  | { kind: 'error'; label: string };

export type TuneEvent =
  | { type: 'tune'; label: string }
  | { type: 'playing' }
  | { type: 'error' }
  | { type: 'slow' }
  | { type: 'dismiss' };

export const SLOW_MS = 8000;
export const ERROR_GRACE_MS = 2000;
export const PLAYING_HIDE_MS = 2500;

export function nextTuneStatus(s: TuneStatus, e: TuneEvent): TuneStatus {
  switch (e.type) {
    case 'tune':
      return { kind: 'tuning', label: e.label };
    case 'playing':
      if (s.kind === 'tuning' || s.kind === 'slow' || s.kind === 'error') {
        return { kind: 'playing', label: s.label };
      }
      return s;
    case 'error':
      if (s.kind === 'tuning' || s.kind === 'slow') {
        return { kind: 'error', label: s.label };
      }
      return s;
    case 'slow':
      if (s.kind === 'tuning') {
        return { kind: 'slow', label: s.label };
      }
      return s;
    case 'dismiss':
      return { kind: 'idle' };
    default:
      return s;
  }
}
