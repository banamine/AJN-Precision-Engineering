// The one active Full Show: an ordered list of parts the Player walks through. Module state + tiny subscribe API,
// no React. A queue only exists while a Full Show is playing; picking anything else clears it.
import type { FullShowPlan, PlanItem } from './ajnShowGroups.ts';

export interface ShowQueueState {
  plan: FullShowPlan; label: string; index: number;
  /** Parts that failed to load during this session (reported in the Player, never hidden). */
  failed: number[];
}
let state: ShowQueueState | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const subscribeShowQueue = (l: () => void): (() => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const getShowQueue = (): ShowQueueState | null => state;
export function startShowQueue(plan: FullShowPlan, label: string): PlanItem | null {
  if (!plan.playable || plan.items.length === 0) return null;
  state = { plan, label, index: 0, failed: [] };
  emit();
  return plan.items[0];
}
export function clearShowQueue(): void { if (state) { state = null; emit(); } }
/** True when `programId` is the part the queue is currently on. */
export function isQueuePart(programId: string | undefined | null): boolean {
  return Boolean(state && programId && state.plan.items[state.index]?.programId === programId);
}
/** Sync the queue to what the Player is actually playing (a manual pick of another part moves the position; anything else ends the queue). */
export function syncShowQueue(programId: string | undefined | null): void {
  if (!state) return;
  const i = state.plan.items.findIndex((it) => it.programId === programId);
  if (i < 0) { clearShowQueue(); return; }
  if (i !== state.index) { state = { ...state, index: i }; emit(); }
}
/** The part after the current one, without moving (for preloading). */
export function peekNextPart(): PlanItem | null { return state ? state.plan.items[state.index + 1] ?? null : null; }
/** Next part (or previous with -1); null at the ends. Marks the current part failed when `failed` is set. */
export function stepShowQueue(direction: 1 | -1, failed = false): PlanItem | null {
  if (!state) return null;
  const items = state.plan.items;
  const failedNow = failed ? [...state.failed, items[state.index].partNo] : state.failed;
  const i = state.index + direction;
  if (i < 0 || i >= items.length) { state = { ...state, failed: failedNow }; emit(); return null; }
  state = { ...state, index: i, failed: failedNow };
  emit();
  return items[i];
}
