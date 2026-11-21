/* Measured sync offsets per episode, shared by the captions and the ad prompt (module level: both read the same facts).
 * lock[j] = file time minus show time inside show segment j. Source 'auto' = matched to the audio, 'manual' = the listener tapped a line. */
export type LockSource = 'auto' | 'manual';
const locks = new Map<string, Map<number, number>>();
const sources = new Map<string, Map<number, LockSource>>();
const MAX = 20;

export function locksOf(ep: string): ReadonlyMap<number, number> { return locks.get(ep) ?? new Map(); }
export function lockSourceOf(ep: string, seg: number): LockSource | null { return sources.get(ep)?.get(seg) ?? null; }
export function setLock(ep: string, seg: number, offset: number, source: LockSource): void {
  let m = locks.get(ep);
  if (!m) { m = new Map(); locks.set(ep, m); sources.set(ep, new Map()); if (locks.size > MAX) { const k = locks.keys().next().value as string; locks.delete(k); sources.delete(k); } }
  m.set(seg, offset); sources.get(ep)?.set(seg, source);
}
export function clearLocks(ep: string): void { locks.delete(ep); sources.delete(ep); }
