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
  probeTimeoutMs: number;
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
  maxProbeIntervalMs: 60_000, // no backoff while down: one cheap HEAD + control per minute, so recovery is seen within ~2 probes
  probeTimeoutMs: 8_000,
});

export interface ArchiveHealthLogEntry {
  ts: number;
  itemKey: string;
  kind: ArchiveHealthEventKind;
  httpStatus: number | null;
  errorCode: string | null;
  counted: boolean;
  state: ArchiveHealthState;
  path: string;
  transitionReason?: string;
}

export interface ArchiveProbeOutcome {
  /** null means no probe result was available (for example, policy blocked the URL). */
  ok: boolean | null;
  httpStatus: number | null;
  errorCode?: string | null;
  errorMessage?: string;
  errorReason?: string;
  path: string;
}

export interface ArchiveHealthStatus {
  /** 'unknown' = no counted Archive success or failure has been observed yet. */
  state: ArchiveHealthState | 'unknown';
  since: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  recent: { failures: number; successes: number; distinctItems: number };
  nextProbeAt: number | null;
  control: 'ok' | 'failed' | 'unknown';
}

export interface ArchiveHealth {
  record(event: {
    ts: number;
    itemKey: string | null;
    kind: ArchiveHealthEventKind;
    httpStatus?: number | null;
    errorCode?: string | null;
    errorMessage?: string;
    errorReason?: string;
    path?: string;
  }): void;
  recordProbe(event: { ts: number; archive: ArchiveProbeOutcome; control: ArchiveProbeOutcome }): void;
  getStatus(): ArchiveHealthStatus;
  shouldProbe(now: number): boolean;
}

type CountedEvent = { ts: number; itemKey: string; kind: 'ok' | 'network' | 'server5xx' };

const NETWORK_FAILURE_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'ETIMEDOUT',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'AJN_UPSTREAM_HEADER_TIMEOUT',
  'AJN_UPSTREAM_CIRCUIT_OPEN',
]);

export function classifyArchiveHealthOutcome(input: {
  status: number | null;
  errorCode?: string | null;
  errorMessage?: string;
  policyFailure?: boolean;
  errorReason?: string;
}): ArchiveHealthEventKind {
  if (input.errorCode === 'UNPLAYABLE_ARCHIVE_MEMBER'
    || [400, 403, 404, 410, 422].includes(input.status ?? -1)) return 'definite';
  if (input.status !== null && input.status >= 200 && input.status < 300 && !input.policyFailure) return 'ok';
  if (input.policyFailure) return 'other';
  if ((input.errorCode && NETWORK_FAILURE_CODES.has(input.errorCode))
    || ['network', 'timeout'].includes(input.errorReason ?? '')
    || /fetch failed|timed?\s*out|network error/i.test(input.errorMessage ?? '')) return 'network';
  if ([500, 502, 503, 504].includes(input.status ?? -1)) return 'server5xx';
  return 'other';
}

export function createArchiveHealth(
  config: Partial<ArchiveHealthConfig> = {},
  deps: { now?: () => number; log?: (entry: ArchiveHealthLogEntry) => void } = {},
): ArchiveHealth {
  const cfg = { ...ARCHIVE_HEALTH_DEFAULTS, ...config };
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((entry: ArchiveHealthLogEntry) => console.log(JSON.stringify(entry)));
  const events: CountedEvent[] = [];
  let state: ArchiveHealthState = 'ok';
  let since = now();
  let lastSuccessAt: number | null = null;
  let lastFailureAt: number | null = null;
  let lastProbeAt: number | null = null;
  let probeIntervalMs = cfg.probeIntervalMs;
  let consecutiveSuccesses = 0;
  let control: ArchiveHealthStatus['control'] = 'unknown';
  let degradedSince: number | null = null;

  const transition = (next: ArchiveHealthState, at: number, reason: string): string | undefined => {
    if (state === next) return undefined;
    state = next;
    since = at;
    degradedSince = next === 'degraded' ? at : null;
    return reason;
  };

  const prune = (at: number) => {
    const cutoff = at - cfg.windowMs;
    while (events.length && events[0].ts < cutoff) events.shift();
    // Events normally arrive in timestamp order. Also remove any stale out-of-order events safely.
    for (let index = events.length - 1; index >= 0; index--) {
      if (events[index].ts < cutoff || events[index].ts > at) events.splice(index, 1);
    }
  };
  const recentAt = (at: number) => events.filter((event) => event.ts >= at - cfg.windowMs && event.ts <= at);
  const failureKind = (kind: ArchiveHealthEventKind) => kind === 'network' || kind === 'server5xx';
  const nextProbeAt = () => state === 'ok'
    ? null
    : (lastProbeAt ?? since) + probeIntervalMs;

  const evaluate = (at: number, latestArchiveFailure: boolean): string | undefined => {
    prune(at);
    const recent = recentAt(at);
    const failures = recent.filter((event) => failureKind(event.kind));
    const successes = recent.filter((event) => event.kind === 'ok');
    const distinctItems = new Set(failures.map((event) => event.itemKey)).size;
    const lastRecentSuccess = successes.reduce<number | null>((latest, event) => Math.max(latest ?? event.ts, event.ts), null);
    const noRecentSuccess = lastRecentSuccess === null || at - lastRecentSuccess >= cfg.noSuccessMs;
    const downThreshold = failures.length >= cfg.downFailureCount
      && distinctItems >= cfg.downDistinctItems
      && noRecentSuccess;
    const samples = failures.length + successes.length;
    const successRatio = samples ? successes.length / samples : 1;
    const degradedThreshold = failures.length >= cfg.degradedFailureCount
      || (samples >= cfg.degradedMinSamples && successRatio < cfg.degradedSuccessRatio);

    // A concurrent failed control check identifies the local network as the problem;
    // this state takes precedence over Archive's own down threshold.
    if (latestArchiveFailure && control === 'failed') {
      return transition('unreachable_from_here', at, 'Archive and control probes/requests failed in the same evaluation');
    }

    if ((state === 'down' || state === 'unreachable_from_here') && consecutiveSuccesses >= 2) {
      consecutiveSuccesses = 0;
      return transition('ok', at, 'two consecutive successful Archive outcomes with no counted failure between them');
    }

    if (downThreshold) {
      return transition('down', at, `down threshold met: ${failures.length} failures, ${distinctItems} distinct keys, no success in ${cfg.noSuccessMs} ms`);
    }

    if (state === 'down') return undefined;

    if (state === 'unreachable_from_here') {
      if (control === 'ok' && degradedThreshold) {
        return transition('degraded', at, 'control probe recovered; Archive failures meet degraded threshold');
      }
      return undefined;
    }

    if (degradedThreshold) {
      return transition('degraded', at, `degraded threshold met: ${failures.length} failures among ${samples} counted samples`);
    }

    if (state === 'degraded'
      && degradedSince !== null
      && at - degradedSince >= cfg.windowMs
      && failures.length < cfg.degradedFailureCount
      && successes.length >= 1) {
      return transition('ok', at, `degraded evidence recovered: full ${cfg.windowMs} ms window with fewer than ${cfg.degradedFailureCount} failures and at least one success`);
    }
    return undefined;
  };

  const emit = (entry: Omit<ArchiveHealthLogEntry, 'state'> & { transitionReason?: string }) => {
    log({ ...entry, state });
  };

  const addArchiveEvent = (event: {
    ts: number;
    itemKey: string;
    kind: ArchiveHealthEventKind;
    httpStatus: number | null;
    errorCode: string | null;
  }) => {
    const counted = event.kind === 'ok' || failureKind(event.kind);
    if (counted) {
      events.push({ ts: event.ts, itemKey: event.itemKey, kind: event.kind as CountedEvent['kind'] });
      if (event.kind === 'ok') {
        lastSuccessAt = event.ts;
        consecutiveSuccesses += 1;
        probeIntervalMs = cfg.probeIntervalMs;
      } else {
        lastFailureAt = event.ts;
        consecutiveSuccesses = 0;
      }
    } else if (event.kind !== 'ok') {
      // A non-success outcome does not affect outage thresholds, but it breaks a
      // recovery streak because the Archive request sequence was not consecutive.
      consecutiveSuccesses = 0;
    }
    return counted;
  };

  return {
    record(event) {
      prune(event.ts);
      const itemKey = event.itemKey || 'home';
      const kind = event.kind;
      const counted = addArchiveEvent({
        ts: event.ts,
        itemKey,
        kind,
        httpStatus: event.httpStatus ?? null,
        errorCode: event.errorCode ?? null,
      });
      const transitionReason = counted ? evaluate(event.ts, failureKind(kind)) : undefined;
      emit({
        ts: event.ts,
        itemKey,
        kind,
        httpStatus: event.httpStatus ?? null,
        errorCode: event.errorCode ?? null,
        counted,
        path: (event.path ?? '/').split(/[?#]/, 1)[0] || '/',
        ...(transitionReason ? { transitionReason } : {}),
      });
    },
    recordProbe(event) {
      lastProbeAt = event.ts;
      prune(event.ts);
      control = event.control.ok === null ? 'unknown' : event.control.ok ? 'ok' : 'failed';
      const archiveKind = classifyArchiveHealthOutcome({
        status: event.archive.httpStatus,
        errorCode: event.archive.errorCode ?? undefined,
        errorMessage: event.archive.errorMessage,
        errorReason: event.archive.errorReason,
      });
      const controlKind = classifyArchiveHealthOutcome({
        status: event.control.httpStatus,
        errorCode: event.control.errorCode ?? undefined,
        errorMessage: event.control.errorMessage,
        errorReason: event.control.errorReason,
      });
      const archiveCounted = addArchiveEvent({
        ts: event.ts,
        itemKey: 'archive-probe',
        kind: archiveKind,
        httpStatus: event.archive.httpStatus,
        errorCode: event.archive.errorCode ?? null,
      });
      const archiveFailed = archiveCounted && failureKind(archiveKind);
      const transitionReason = evaluate(event.ts, archiveFailed);
      if (archiveFailed) {
        probeIntervalMs = Math.min(cfg.maxProbeIntervalMs, Math.max(cfg.probeIntervalMs, probeIntervalMs * 2));
      } else if (archiveKind === 'ok') {
        probeIntervalMs = cfg.probeIntervalMs;
      }
      emit({
        ts: event.ts,
        itemKey: 'archive-probe',
        kind: archiveKind,
        httpStatus: event.archive.httpStatus,
        errorCode: event.archive.errorCode ?? null,
        counted: archiveCounted,
        path: event.archive.path.split(/[?#]/, 1)[0] || '/',
        ...(transitionReason ? { transitionReason } : {}),
      });
      emit({
        ts: event.ts,
        itemKey: 'control-probe',
        kind: controlKind,
        httpStatus: event.control.httpStatus,
        errorCode: event.control.errorCode ?? null,
        counted: false,
        path: event.control.path.split(/[?#]/, 1)[0] || '/',
      });
    },
    getStatus() {
      const at = now();
      prune(at);
      const recent = recentAt(at);
      const failures = recent.filter((event) => failureKind(event.kind));
      const successes = recent.filter((event) => event.kind === 'ok');
      const distinctItems = new Set(failures.map((event) => event.itemKey)).size;
      const noEvidence = state === 'ok' && lastSuccessAt === null && lastFailureAt === null;
      return {
        state: noEvidence ? 'unknown' : state,
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
