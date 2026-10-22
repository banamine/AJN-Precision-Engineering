import type { Digest } from "./newsDigest";

export interface DigestResponse {
  digest: Digest;
  fetchedAt: string | null;
  status: "ok" | "error" | "pending";
  error: string | null;
}

export interface DigestView {
  phase: "loading" | "ready" | "error";
  data: DigestResponse | null;
  error: string | null;
}

export const DIGEST_POLL_MS = 15 * 60_000;

type DigestStoreOptions = {
  fetcher?: (input: string, init?: RequestInit) => Promise<Response>;
  schedule?: (callback: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
};

const INITIAL_VIEW: DigestView = { phase: "loading", data: null, error: null };

/**
 * Shared external store for the Radio page and persistent player. Multiple
 * subscribers share one request and one 15-minute timer instead of polling
 * /api/digest independently.
 */
export function createDigestStore(options: DigestStoreOptions = {}) {
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  const schedule = options.schedule ?? ((callback, ms) => window.setInterval(callback, ms));
  const cancel = options.cancel ?? ((handle) => window.clearInterval(handle as number));
  let view = INITIAL_VIEW;
  let timer: unknown = null;
  let activeController: AbortController | null = null;
  const listeners = new Set<() => void>();

  const getSnapshot = () => view;
  const publish = (next: DigestView) => {
    view = next;
    for (const listener of listeners) listener();
  };

  const refresh = async () => {
    if (activeController) return;
    const controller = new AbortController();
    activeController = controller;
    try {
      const response = await fetcher("/api/digest", { signal: controller.signal });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${response.status}`);
      }
      const data = await response.json() as DigestResponse;
      if (activeController === controller && !controller.signal.aborted) {
        publish({ phase: "ready", data, error: null });
      }
    } catch (error) {
      if (activeController !== controller || controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      publish({ phase: view.data ? "ready" : "error", data: view.data, error: message });
    } finally {
      if (activeController === controller) activeController = null;
    }
  };

  const stop = () => {
    if (listeners.size > 0) return;
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
    const controller = activeController;
    activeController = null;
    controller?.abort();
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    if (listeners.size === 1) {
      void refresh();
      timer = schedule(() => { void refresh(); }, DIGEST_POLL_MS);
    }
    return () => {
      listeners.delete(listener);
      stop();
    };
  };

  return { getSnapshot, subscribe, refresh };
}

export const digestStore = createDigestStore();
