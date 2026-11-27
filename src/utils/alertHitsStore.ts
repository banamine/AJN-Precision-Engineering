/* The hits from the last alert check, shared between the Alerts panel (writes) and the caption bar (reads: Prev/Next hit). In memory only. */
import { useSyncExternalStore } from 'react';
import type { AlertHit } from './alertMatch.ts';

let current: readonly AlertHit[] = [];
const listeners = new Set<() => void>();

export function setAlertHits(hits: readonly AlertHit[]): void { current = hits; for (const l of [...listeners]) l(); }
export function getAlertHits(): readonly AlertHit[] { return current; }
export function subscribeAlertHits(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; }
export function useAlertHits(): readonly AlertHit[] { return useSyncExternalStore(subscribeAlertHits, getAlertHits, getAlertHits); }
