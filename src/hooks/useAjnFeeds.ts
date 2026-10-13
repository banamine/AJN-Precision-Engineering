import { useSyncExternalStore } from 'react';
import { loadAjnFeeds, type AjnFeedsResult } from '../services/ajnFeeds';

// One shared AJN feed store for the whole app: a single fetch, a single 5-minute refresh, paused while the tab is hidden.
// Home panel, TV Guide panel and the Home carousel all read the same data instead of each fetching it.
const REFRESH_MS = 5 * 60 * 1000;

export interface AjnFeedsState {
  status: 'loading' | 'ready' | 'error';
  data: AjnFeedsResult | null;
  error: string | null;
  checkedAt: string | null;
  refreshing: boolean;
}

let state: AjnFeedsState = { status: 'loading', data: null, error: null, checkedAt: null, refreshing: false };
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;
let controller: AbortController | null = null;
let timer: number | null = null;

function emit(next: Partial<AjnFeedsState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export function reloadAjnFeeds(): Promise<void> {
  if (inflight) return inflight;
  const c = new AbortController();
  controller = c;
  emit({ refreshing: true });
  const p: Promise<void> = loadAjnFeeds(c.signal)
    .then((data) => {
      if (c.signal.aborted) return;
      emit({ status: 'ready', data, error: null, checkedAt: new Date().toISOString(), refreshing: false });
    })
    .catch((err) => {
      if (c.signal.aborted) return;
      emit({ status: state.data ? 'ready' : 'error', error: err instanceof Error ? err.message : 'Unable to load AJN resources', refreshing: false });
    })
    .finally(() => {
      if (inflight === p) inflight = null;
      if (controller === c) controller = null;
    });
  inflight = p;
  return p;
}

function isStale(): boolean {
  const t = state.checkedAt ? Date.parse(state.checkedAt) : NaN;
  return !Number.isFinite(t) || Date.now() - t >= REFRESH_MS;
}

function onVisibility() {
  if (!document.hidden && isStale()) void reloadAjnFeeds();
}

function start() {
  if (isStale()) void reloadAjnFeeds();
  timer = window.setInterval(() => { if (!document.hidden) void reloadAjnFeeds(); }, REFRESH_MS);
  document.addEventListener('visibilitychange', onVisibility);
}

function stop() {
  if (timer !== null) window.clearInterval(timer);
  timer = null;
  document.removeEventListener('visibilitychange', onVisibility);
  controller?.abort();
  controller = null;
  inflight = null;
  state = { ...state, refreshing: false };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

export function useAjnFeeds(): AjnFeedsState & { reload: () => Promise<void> } {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => state);
  return { ...snapshot, reload: reloadAjnFeeds };
}
