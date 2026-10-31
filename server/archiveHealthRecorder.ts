import { archiveIdentifierAndRest } from './archiveFetch.js';
import { classifyArchiveHealthOutcome, type ArchiveHealth, type ArchiveHealthEventKind } from './archiveHealth.js';
import { validateArchivePath } from './archivePathEncoding.js';

export type ArchiveRequestClass = 'search' | 'metadata' | 'home';

export interface ArchiveHealthOutcome {
  path: string;
  status: number | null;
  errorCode?: string | null;
  errorMessage?: string;
  errorReason?: string;
  policyFailure?: boolean;
  requestClass?: ArchiveRequestClass;
  ts?: number;
}

function safePath(path: string): string {
  const canonical = validateArchivePath(path);
  if (canonical.valid && canonical.cleanPath) {
    return canonical.cleanPath.replace(
      /(?:\?|%3F)(?:token|session|auth|access_token|key|password)=.*/ig,
      '',
    );
  }
  try {
    return new URL(path, 'https://archive.org').pathname || '/';
  } catch {
    return path.split(/[?#]/, 1)[0] || '/';
  }
}

function decodePathSegment(segment: string): string {
  try { return decodeURIComponent(segment); } catch { return segment; }
}

function identifierFromPath(path: string): string | null {
  const pathname = safePath(path);
  const match = pathname.match(/^\/(?:download|metadata)\/([^/]+)(?:\/|$)/);
  return match ? decodePathSegment(match[1]) : null;
}

function inferRequestClass(path: string): ArchiveRequestClass {
  const pathname = safePath(path);
  if (/^(?:\/advancedsearch\.php|\/services\/search(?:\/|$))/i.test(pathname)) return 'search';
  if (/^\/metadata(?:\/|$)/i.test(pathname)) return 'metadata';
  return 'home';
}

/** Call once per logical proxy request, after its internal retries have completed. */
export function recordArchiveHealthOutcome(health: ArchiveHealth, outcome: ArchiveHealthOutcome): ArchiveHealthEventKind {
  const path = safePath(outcome.path);
  const itemKey = identifierFromPath(path)
    ?? archiveIdentifierAndRest(`https://archive.org${path}`)?.id
    ?? outcome.requestClass
    ?? inferRequestClass(path);
  const kind = classifyArchiveHealthOutcome(outcome);
  health.record({
    ts: outcome.ts ?? Date.now(),
    itemKey,
    kind,
    httpStatus: outcome.status,
    errorCode: outcome.errorCode ?? null,
    errorMessage: outcome.errorMessage,
    errorReason: outcome.errorReason,
    path,
  });
  return kind;
}

/** A single route/logical request may report through more than one internal path; record it once. */
export function createLogicalArchiveHealthRecorder(
  health: ArchiveHealth,
  path: string,
): (outcome: Omit<ArchiveHealthOutcome, 'path' | 'ts'> & { ts?: number }) => ReturnType<ArchiveHealth['getStatus']> {
  let recorded = false;
  return (outcome) => {
    if (!recorded) {
      recordArchiveHealthOutcome(health, { ...outcome, path });
      recorded = true;
    }
    return health.getStatus();
  };
}
