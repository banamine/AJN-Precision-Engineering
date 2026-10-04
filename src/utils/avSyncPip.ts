// Tiny external store for the mini video overlay (Parallel Audio/Video Sync). One overlay at most.
// Lives outside React so the Radio panel, the mini dock and the Player page can all open/close the same overlay without prop drilling.
import { useSyncExternalStore } from 'react';

export interface PipState { programId: string; src: string; title: string }

let state: PipState | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

export const pipStore = {
  get: (): PipState | null => state,
  open(next: PipState) { state = next; emit(); },
  close() { if (state === null) return; state = null; emit(); },
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
};

export function usePip(): PipState | null {
  return useSyncExternalStore(pipStore.subscribe, pipStore.get, pipStore.get);
}
