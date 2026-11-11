// Tiny external store: lets the waiting room show what the jingle is doing (and a sound on/off key) without prop drilling.
import { useSyncExternalStore } from 'react';
import { JINGLE_PREF_KEY, jingleEnabled } from './bufferJingle';

export interface JingleView { supported: boolean; playing: boolean; on: boolean }
const store = (): Storage | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };
let view: JingleView = { supported: false, playing: false, on: jingleEnabled(store()) };
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((l) => l());
const patch = (p: Partial<JingleView>): void => { const next = { ...view, ...p }; if (next.supported === view.supported && next.playing === view.playing && next.on === view.on) return; view = next; emit(); };

export const jingleStore = {
  get: (): JingleView => view,
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  setSupported: (supported: boolean) => patch({ supported, ...(supported ? {} : { playing: false }) }),
  setPlaying: (playing: boolean) => patch({ playing }),
  /** Listener's sound switch; remembered across visits. */
  setOn(on: boolean) { try { store()?.setItem(JINGLE_PREF_KEY, on ? 'on' : 'off'); } catch { /* storage blocked: lasts this visit */ } patch({ on, ...(on ? {} : { playing: false }) }); },
};
export const useJingle = (): JingleView => useSyncExternalStore(jingleStore.subscribe, jingleStore.get, jingleStore.get);
