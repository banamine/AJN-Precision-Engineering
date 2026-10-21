import type { ArchiveHealth } from './archiveHealth.js';
import { anyPublicHost, safeFetch } from './safeFetch.js';

export type ArchiveHealthFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface ArchiveHealthProbeDeps {
  health: ArchiveHealth;
  fetchImpl: ArchiveHealthFetch;
  now?: () => number;
  controlUrl?: string;
  intervalMs?: number;
  timeoutMs?: number;
  setIntervalImpl?: typeof setInterval;
  clearIntervalImpl?: typeof clearInterval;
}

async function requestOk(
  fetchImpl: ArchiveHealthFetch,
  url: string,
  method: 'HEAD' | 'GET',
  timeoutMs: number,
): Promise<boolean> {
  try {
    const host = new URL(url).hostname;
    const methodFetch: ArchiveHealthFetch = (input, init) => fetchImpl(input, { ...init, method });
    const { res } = await safeFetch(url, {
      allow: host === 'archive.org' ? (candidate) => candidate === 'archive.org' : anyPublicHost,
      timeoutMs,
      fetchImpl: methodFetch,
      headers: { 'User-Agent': 'AJN-Archive-Health-Probe/1.0', Accept: '*/*' },
      maxRedirects: 3,
    });
    await res.body?.cancel().catch(() => {});
    return res.ok;
  } catch {
    return false;
  }
}

/** Polls only while non-ok. Native fetch is passed by production startup; tests inject their own fetch and clock. */
export function startArchiveHealthProber(deps: ArchiveHealthProbeDeps): { stop(): void } {
  const now = deps.now ?? Date.now;
  const intervalMs = deps.intervalMs ?? 60_000;
  const timeoutMs = deps.timeoutMs ?? 8_000;
  const setIntervalImpl = deps.setIntervalImpl ?? setInterval;
  const clearIntervalImpl = deps.clearIntervalImpl ?? clearInterval;
  const controlUrl = deps.controlUrl ?? 'https://www.gstatic.com/generate_204';
  let running = false;
  const tick = async () => {
    const at = now();
    if (running || deps.health.getStatus().state === 'ok' || !deps.health.shouldProbe(at)) return;
    running = true;
    try {
      let controlAllowed = false;
      try {
        const parsed = new URL(controlUrl);
        controlAllowed = parsed.protocol === 'https:';
      } catch {
        controlAllowed = false;
      }
      const [archiveOk, controlOk] = await Promise.all([
        requestOk(deps.fetchImpl, 'https://archive.org/', 'HEAD', timeoutMs),
        controlAllowed ? requestOk(deps.fetchImpl, controlUrl, 'GET', timeoutMs) : Promise.resolve(false),
      ]);
      deps.health.recordProbe({ ts: now(), archiveOk, controlOk });
    } finally {
      running = false;
    }
  };
  const timer = setIntervalImpl(async () => { await tick(); }, intervalMs);
  (timer as unknown as { unref?: () => void }).unref?.();
  return { stop: () => clearIntervalImpl(timer) };
}
