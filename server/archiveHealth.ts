export type ArchiveHealthState = 'ok' | 'degraded' | 'down' | 'unreachable_from_here';
export type ArchiveHealthEventKind = 'ok' | 'network' | 'server5xx' | 'definite' | 'other';

export interface ArchiveHealthConfig {
  windowMs: number;
  downFailureCount: number;
  downDistinctItems: number;
  noSuccessMs: number;
  degradedFailureCount: number;
  degradedMinSamples: number;
  degradedSuccessRatio: number;
  probeIntervalMs: number;
  maxProbeIntervalMs: number;
}

export const ARCHIVE_HEALTH_DEFAULTS: Readonly<ArchiveHealthConfig> = Object.freeze({
  windowMs: 60_000,
  downFailureCount: 5,
  downDistinctItems: 3,
  noSuccessMs: 30_000,
  degradedFailureCount: 3,
  degradedMinSamples: 6,
  degradedSuccessRatio: 0.5,
  probeIntervalMs: 60_000,
  maxProbeIntervalMs: 300_000,
});

export interface ArchiveHealthStatus {
  state: ArchiveHealthState;
  since: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  recent: { failures: number; successes: number; distinctItems: number };
  nextProbeAt: number | null;
  control: 'ok' | 'failed' | 'unknown';
}

export interface ArchiveHealth {
  record(event: { ts: number; itemKey: string | null; kind: ArchiveHealthEventKind }): void;
  recordProbe(event: { ts: number; archiveOk: boolean; controlOk: boolean }): void;
  getStatus(): ArchiveHealthStatus;
  shouldProbe(now: number): boolean;
}

type Event = { ts: number; itemKey: string | null; kind: ArchiveHealthEventKind };

const NETWORK_FAILURE_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'ETIMEDOUT',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'AJN_UPSTREAM_HEADER_TIMEOUT',
  'AJN_UPSTREAM_CIRCUIT_OPEN',
  'FETCH_FAILED',
]);

export function classifyArchiveHealthOutcome(input: {
  status: number;
  errorCode?: string;
  errorMessage?: string;
  policyFailure?: boolean;
}): ArchiveHealthEventKind {
  if (input.status >= 200 && input.status < 300 && !input.policyFailure) return 'ok';
  if (input.policyFailure) return 'other';
  if ((input.errorCode && NETWORK_FAILURE_CODES.has(input.errorCode))
    || /fetch failed/i.test(input.errorMessage ?? '')) return 'network';
  if ([500, 502, 503, 504].includes(input.status)) return 'server5xx';
  if ([400, 403, 404, 410, 422].includes(input.status)) return 'definite';
  return 'other';
}

export function createArchiveHealth(
  config: Partial<ArchiveHealthConfig> = {},
  deps: { now?: () => number } = {},
): ArchiveHealth {
  const cfg = { ...ARCHIVE_HEALTH_DEFAULTS, ...config };
  const now = deps.now ?? Date.now;
  const events: Event[] = [];
  let state: ArchiveHealthState = 'ok';
  let since = now();
  let lastSuccessAt: number | null = null;
  let lastFailureAt: number | null = null;
  let lastProbeAt: number | null = null;
  let probeIntervalMs = cfg.probeIntervalMs;
  let consecutiveSuccessfulProbes = 0;
  let control: ArchiveHealthStatus['control'] = 'unknown';

  const transition = (next: ArchiveHealthState, at: number) => {
    if (state === next) return;
    state = next;
    since = at;
  };

  const recentAt = (at: number) => events.filter((event) => event.ts > at - cfg.windowMs && event.ts <= at);
  const failureKind = (kind: ArchiveHealthEventKind) => kind === 'network' || kind === 'server5xx';
  const nextProbeAt = () => state === 'ok'
    ? null
    : (lastProbeAt ?? since) + probeIntervalMs;

  const refreshObservedState = (at: number) => {
    // An outage state is cleared only by the explicit two-good-probe recovery rule.
    if (state === 'down' || state === 'unreachable_from_here') return;
    const recent = recentAt(at);
    const failures = recent.filter((event) => failureKind(event.kind));
    const successes = recent.filter((event) => event.kind === 'ok');
    const distinctItems = new Set(failures.map((event) => event.itemKey).filter((key): key is string => Boolean(key))).size;
    const lastRecentSuccess = successes.reduce<number | null>((latest, event) => Math.max(latest ?? event.ts, event.ts), null);
    const noRecentSuccess = lastRecentSuccess === null || at - lastRecentSuccess >= cfg.noSuccessMs;
    if (failures.length >= cfg.downFailureCount && distinctItems >= cfg.downDistinctItems && noRecentSuccess) {
      transition('down', at);
      return;
    }
    const samples = failures.length + successes.length;
    const successRatio = samples ? successes.length / samples : 1;
    if (failures.length >= cfg.degradedFailureCount
      || (samples >= cfg.degradedMinSamples && successRatio < cfg.degradedSuccessRatio)) {
      transition('degraded', at);
    } else {
      transition('ok', at);
    }
  };

  return {
    record(event) {
      events.push({ ...event });
      if (event.kind === 'ok') lastSuccessAt = event.ts;
      if (failureKind(event.kind)) lastFailureAt = event.ts;
      refreshObservedState(event.ts);
    },
    recordProbe(event) {
      lastProbeAt = event.ts;
      control = event.controlOk ? 'ok' : 'failed';
      if (event.archiveOk) {
        consecutiveSuccessfulProbes += 1;
        probeIntervalMs = cfg.probeIntervalMs;
        if (consecutiveSuccessfulProbes >= 2) {
          transition('ok', event.ts);
          consecutiveSuccessfulProbes = 0;
        }
        return;
      }
      consecutiveSuccessfulProbes = 0;
      probeIntervalMs = Math.min(cfg.maxProbeIntervalMs, Math.max(cfg.probeIntervalMs, probeIntervalMs * 2));
      transition(event.controlOk ? 'down' : 'unreachable_from_here', event.ts);
    },
    getStatus() {
      const at = now();
      const recent = recentAt(at);
      const failures = recent.filter((event) => failureKind(event.kind));
      const successes = recent.filter((event) => event.kind === 'ok');
      const distinctItems = new Set(failures.map((event) => event.itemKey).filter((key): key is string => Boolean(key))).size;
      return {
        state,
        since,
        lastSuccessAt,
        lastFailureAt,
        recent: { failures: failures.length, successes: successes.length, distinctItems },
        nextProbeAt: nextProbeAt(),
        control,
      };
    },
    shouldProbe(at) {
      return state !== 'ok' && at >= (nextProbeAt() ?? Number.POSITIVE_INFINITY);
    },
  };
}
