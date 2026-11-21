// Tiny external store for the mini video overlay (Parallel Audio/Video Sync). One overlay at most.
// Lives outside React so the Radio panel, the mini dock and the Player page can all open/close the same overlay without prop drilling.
import { useSyncExternalStore } from 'react';

export interface PipState { programId: string; src: string; title: string }

let state: PipState | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

/** Episodes whose mini video the listener closed on purpose: it is not opened again by itself for them. */
const dismissed = new Set<string>();

export const pipStore = {
  get: (): PipState | null => state,
  /** Open by hand (WATCH / mini-video button): clears an earlier "I closed it". */
  open(next: PipState) { dismissed.delete(next.programId); state = next; emit(); },
  /** Open automatically; refused for an episode the listener closed. Returns whether it opened. */
  autoOpen(next: PipState): boolean { if (dismissed.has(next.programId) || state !== null) return false; state = next; emit(); return true; },
  isDismissed: (programId: string): boolean => dismissed.has(programId),
  close() { if (state === null) return; state = null; emit(); },
  /** The listener closed it (X or CLOSE MINI VIDEO): remember that for this episode. */
  closeByUser() { if (state === null) return; dismissed.add(state.programId); state = null; emit(); },
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
};

export function usePip(): PipState | null {
  return useSyncExternalStore(pipStore.subscribe, pipStore.get, pipStore.get);
}

/** Mini video position, in px from the viewport's top-left. Null = the default docked corner. */
export interface PipPos { x: number; y: number }
export const PIP_POS_KEY = 'ajn.pip.pos';
/** Keeps the whole window (or at least its header) on screen after a drag, a keyboard nudge or a window resize. */
export function clampPipPos(pos: PipPos, size: { w: number; h: number }, view: { w: number; h: number }, margin = 4): PipPos {
  const maxX = Math.max(margin, view.w - size.w - margin);
  const maxY = Math.max(margin, view.h - size.h - margin);
  return { x: Math.min(Math.max(pos.x, margin), maxX), y: Math.min(Math.max(pos.y, margin), maxY) };
}
export function readPipPos(storage: Pick<Storage, 'getItem'> | null): PipPos | null {
  try {
    const raw = storage?.getItem(PIP_POS_KEY); if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PipPos>;
    return typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null;
  } catch { return null; }
}
