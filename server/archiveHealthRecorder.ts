import { archiveIdentifierAndRest } from './archiveFetch.js';
import { classifyArchiveHealthOutcome, type ArchiveHealth, type ArchiveHealthEventKind } from './archiveHealth.js';

export interface ArchiveHealthOutcome {
  path: string;
  status: number;
  errorCode?: string;
  errorMessage?: string;
  policyFailure?: boolean;
  ts?: number;
}

/** Call once per logical proxy request, after its internal retries have completed. */
export function recordArchiveHealthOutcome(health: ArchiveHealth, outcome: ArchiveHealthOutcome): ArchiveHealthEventKind {
  const itemKey = archiveIdentifierAndRest(`https://archive.org${outcome.path}`)?.id ?? null;
  const kind = classifyArchiveHealthOutcome(outcome);
  health.record({ ts: outcome.ts ?? Date.now(), itemKey, kind });
  return kind;
}
