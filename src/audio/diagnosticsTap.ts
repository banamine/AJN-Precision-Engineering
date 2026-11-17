import { useSyncExternalStore } from 'react';

/**
 * Read-only hand-off of the player's diagnostics analyser tap and buffer line.
 * MinimalPlayer publishes; Developer Mode (Neural Twin page) subscribes.
 * No new audio nodes are created here: it only passes along the existing tap.
 */
export interface DiagnosticsTap {
  analyser: AnalyserNode | null;
  bufferLine: string;
  onCopyBufferLog?: () => Promise<boolean>;
}

const EMPTY: DiagnosticsTap = { analyser: null, bufferLine: 'Buffer: idle' };
let current: DiagnosticsTap = EMPTY;
const listeners = new Set<() => void>();

export function publishDiagnosticsTap(next: DiagnosticsTap): void {
  if (current.analyser === next.analyser && current.bufferLine === next.bufferLine && current.onCopyBufferLog === next.onCopyBufferLog) return;
  current = next;
  listeners.forEach((l) => l());
}

/** Called when the player unmounts so Developer Mode never holds a dead analyser. */
export function resetDiagnosticsTap(): void {
  if (current === EMPTY) return;
  current = EMPTY;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function useDiagnosticsTap(): DiagnosticsTap {
  return useSyncExternalStore(subscribe, () => current, () => EMPTY);
}
