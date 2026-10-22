import { ARCHIVE_HEALTH_DEFAULTS, type ArchiveHealth } from './archiveHealth.js';
import { isAllowedArchiveHost } from './archiveFetch.js';
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

function runtimeErrorCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    const item = current as { code?: unknown; cause?: unknown };
    if (typeof item.code === 'string' && item.code.length > 0) return item.code;
    current = item.cause;
  }
  return null;
}

async function requestOutcome(
  fetchImpl: ArchiveHealthFetch,
  url: string,
  method: 'HEAD' | 'GET',
  timeoutMs: number,
): Promise<{
  ok: boolean | null;
  httpStatus: number | null;
  errorCode: string | null;
  errorMessage?: string;
  errorReason?: string;
  path: string;
}> {
  const path = new URL(url).pathname || '/';
  try {
    const host = new URL(url).hostname;
    const methodFetch: ArchiveHealthFetch = (input, init) => fetchImpl(input, { ...init, method });
    const { res } = await safeFetch(url, {
      allow: host === 'archive.org' ? (candidate) => candidate === 'archive.org' : anyPublicHost,
      timeoutMs,
      fetchImpl: methodFetch,
      headers: { 'User-Agent': 'AJN-Archive-Health-Probe/1.0', Accept: '*/*' },
      // The Archive health check is deliberately one physical request.
      maxRedirects: host === 'archive.org' ? 0 : 3,
    });
    await res.body?.cancel().catch(() => {});
    return {
      ok: res.status >= 200 && res.status < 300,
      httpStatus: res.status,
      errorCode: null,
      path,
    };
  } catch (error) {
    const reason = typeof error === 'object' && error !== null && 'reason' in error
      ? String((error as { reason?: unknown }).reason ?? '')
      : '';
    const didNotRun = ['blocked', 'redirect_blocked', 'too_many_redirects'].includes(reason);
    return {
      ok: didNotRun ? null : false,
      httpStatus: null,
      errorCode: runtimeErrorCode(error),
      errorMessage: error instanceof Error ? error.message : undefined,
      errorReason: reason || undefined,
      path,
    };
  }
}

/** Polls only while non-ok. Native fetch is passed by production startup; tests inject their own fetch and clock. */
export function startArchiveHealthProber(deps: ArchiveHealthProbeDeps): { stop(): void } {
  const now = deps.now ?? Date.now;
  const intervalMs = deps.intervalMs ?? ARCHIVE_HEALTH_DEFAULTS.probeIntervalMs;
  const timeoutMs = deps.timeoutMs ?? ARCHIVE_HEALTH_DEFAULTS.probeTimeoutMs;
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
        controlAllowed = parsed.protocol === 'https:'
          && !parsed.port
          && !parsed.username
          && !parsed.password
          && !isAllowedArchiveHost(parsed.hostname);
      } catch {
        controlAllowed = false;
      }
      const [archive, control] = await Promise.all([
        requestOutcome(deps.fetchImpl, 'https://archive.org/', 'HEAD', timeoutMs),
        controlAllowed
          ? requestOutcome(deps.fetchImpl, controlUrl, 'GET', timeoutMs)
          : Promise.resolve({
            ok: null,
            httpStatus: null,
            errorCode: null,
            errorReason: 'blocked',
            path: '/',
          }),
      ]);
      deps.health.recordProbe({ ts: now(), archive, control });
    } finally {
      running = false;
    }
  };
  // Tick often and let shouldProbe() decide when a probe is due. Ticking exactly every probe
  // interval made each tick land a moment before the due time (lastProbeAt is stamped after the
  // request finishes), so every other tick was skipped and probes ran at twice the intended spacing.
  const tickMs = Math.min(intervalMs, 5_000);
  const timer = setIntervalImpl(async () => { await tick(); }, tickMs);
  (timer as unknown as { unref?: () => void }).unref?.();
  return { stop: () => clearIntervalImpl(timer) };
}
