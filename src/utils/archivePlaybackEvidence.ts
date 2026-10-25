export const ARCHIVE_PROGRESS_WINDOW_MS = 20_000;

type Listener = () => void;
const listeners = new Set<Listener>();
let lastArchiveProgressAt: number | null = null;
let currentArchiveSource: string | null = null;
let previousPosition: number | null = null;
let lastArchiveProgressSeconds: number | null = null;

function archiveSourceKey(source: string | null | undefined): string | null {
  if (!source) return null;
  try {
    const url = new URL(source, 'https://ajn.invalid');
    if (url.pathname === '/api/archive/proxy') {
      const path = url.searchParams.get('path') ?? '';
      if (!path.startsWith('/download/')) return null;
      return `archive-source:${path.split(/[?#]/, 1)[0]}`;
    }
    if (url.protocol === 'https:'
      && (url.hostname === 'archive.org' || url.hostname.endsWith('.archive.org'))
      && url.pathname.startsWith('/download/')) {
      return `archive-source:${url.pathname}`;
    }
  } catch {
    return null;
  }
  return null;
}

function publish(): void {
  for (const listener of listeners) listener();
}

export function isArchivePlaybackSource(source: string | null | undefined): boolean {
  return archiveSourceKey(source) !== null;
}

/** Call only from a playing media element's existing progress callback. */
export function recordArchivePlaybackProgress(
  source: string | null | undefined,
  currentTime: number,
  now = Date.now(),
): boolean {
  const key = archiveSourceKey(source);
  if (!key) {
    if (currentArchiveSource !== null) {
      currentArchiveSource = null;
      previousPosition = null;
      lastArchiveProgressAt = null;
      lastArchiveProgressSeconds = null;
      publish();
    }
    return false;
  }
  if (!Number.isFinite(currentTime) || currentTime < 0) return false;
  if (key !== currentArchiveSource) {
    currentArchiveSource = key;
    previousPosition = currentTime;
    lastArchiveProgressAt = null;
    lastArchiveProgressSeconds = null;
    publish();
    return false;
  }
  if (previousPosition !== null && currentTime < previousPosition) {
    previousPosition = currentTime;
    lastArchiveProgressAt = null;
    lastArchiveProgressSeconds = null;
    publish();
    return false;
  }
  if (previousPosition === null || currentTime <= previousPosition) {
    previousPosition = currentTime;
    return false;
  }
  previousPosition = currentTime;
  lastArchiveProgressAt = now;
  lastArchiveProgressSeconds = currentTime;
  publish();
  return true;
}

export function getLastArchiveProgressAt(source?: string | null): number | null {
  if (source && archiveSourceKey(source) !== currentArchiveSource) return null;
  return lastArchiveProgressAt;
}

export function getLastArchiveProgressPosition(source?: string | null): number | null {
  if (source && archiveSourceKey(source) !== currentArchiveSource) return null;
  return lastArchiveProgressSeconds;
}

export function subscribeArchiveProgress(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function shouldShowOutageBanner(
  state: 'ok' | 'degraded' | 'down' | 'unreachable_from_here' | 'unknown',
  now: number,
  progressAt: number | null,
  windowMs = ARCHIVE_PROGRESS_WINDOW_MS,
): boolean {
  if (state === 'ok' || state === 'unknown') return false;
  const recentProgress = progressAt !== null
    && Number.isFinite(progressAt)
    && now >= progressAt
    && now - progressAt <= windowMs;
  if (recentProgress) return false;
  return true;
}
