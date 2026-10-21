import { useSyncExternalStore } from 'react';
import type { ArchiveHealthState } from '../../server/archiveHealth';

export type ClientArchiveState = ArchiveHealthState | 'unknown';
export interface ClientArchiveStatus {
  state: ClientArchiveState;
  since: number | null;
}

export interface ArchiveStatusPollerDeps {
  fetchImpl: typeof fetch;
  isVisible: () => boolean;
  onVisibilityChange: (listener: () => void) => () => void;
  setIntervalImpl?: typeof setInterval;
  clearIntervalImpl?: typeof clearInterval;
  intervalMs?: number;
}

export interface ArchiveStatusPoller {
  getSnapshot(): ClientArchiveStatus;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<ClientArchiveStatus>;
}

const isArchiveState = (value: unknown): value is ArchiveHealthState =>
  value === 'ok' || value === 'degraded' || value === 'down' || value === 'unreachable_from_here';

export function createArchiveStatusPoller(deps: ArchiveStatusPollerDeps): ArchiveStatusPoller {
  const subscribers = new Set<() => void>();
  const setIntervalImpl = deps.setIntervalImpl ?? setInterval;
  const clearIntervalImpl = deps.clearIntervalImpl ?? clearInterval;
  const intervalMs = deps.intervalMs ?? 30_000;
  let snapshot: ClientArchiveStatus = { state: 'unknown', since: null };
  let timer: ReturnType<typeof setInterval> | null = null;
  let removeVisibilityListener: (() => void) | null = null;
  let controller: AbortController | null = null;
  let requestId = 0;

  const publish = (next: ClientArchiveStatus) => {
    if (snapshot.state === next.state && snapshot.since === next.since) return;
    snapshot = next;
    for (const listener of subscribers) listener();
  };

  const refresh = async (): Promise<ClientArchiveStatus> => {
    if (!deps.isVisible()) return snapshot;
    controller?.abort();
    const currentController = new AbortController();
    controller = currentController;
    const id = ++requestId;
    try {
      const response = await deps.fetchImpl('/api/archive/status', {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: currentController.signal,
      });
      if (!response.ok) throw new Error(`Archive status HTTP ${response.status}`);
      const data = await response.json() as { state?: unknown; since?: unknown };
      if (id !== requestId) return snapshot;
      publish({
        state: isArchiveState(data.state) ? data.state : 'unknown',
        since: Number.isFinite(data.since) ? Number(data.since) : null,
      });
    } catch {
      if (id === requestId && !currentController.signal.aborted) publish({ state: 'unknown', since: null });
    } finally {
      if (controller === currentController) controller = null;
    }
    return snapshot;
  };

  const stopPolling = () => {
    if (timer !== null) clearIntervalImpl(timer);
    timer = null;
    controller?.abort();
    controller = null;
  };
  const startPolling = () => {
    if (!deps.isVisible() || timer !== null) return;
    void refresh();
    timer = setIntervalImpl(() => { if (deps.isVisible()) void refresh(); }, intervalMs);
  };
  const onVisibility = () => {
    if (deps.isVisible()) startPolling();
    else stopPolling();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      subscribers.add(listener);
      if (subscribers.size === 1) {
        removeVisibilityListener = deps.onVisibilityChange(onVisibility);
        startPolling();
      }
      return () => {
        subscribers.delete(listener);
        if (subscribers.size === 0) {
          stopPolling();
          removeVisibilityListener?.();
          removeVisibilityListener = null;
        }
      };
    },
    refresh,
  };
}

const browserStatusStore = createArchiveStatusPoller({
  fetchImpl: (...args) => fetch(...args),
  isVisible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
  onVisibilityChange: (listener) => {
    if (typeof document === 'undefined') return () => {};
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  },
});

export function useArchiveStatus(): ClientArchiveStatus & { refresh: ArchiveStatusPoller['refresh'] } {
  const status = useSyncExternalStore(
    browserStatusStore.subscribe,
    browserStatusStore.getSnapshot,
    browserStatusStore.getSnapshot,
  );
  return { ...status, refresh: browserStatusStore.refresh };
}
