import type { Program } from '../types';

export const NEWS_STALE_AFTER_MS = 48 * 60 * 60 * 1000;

export type NewsFreshness = {
  state: 'fresh' | 'stale' | 'unknown';
  latestAiredAt: string | null;
};

function airedAtMs(program: Program): number | null {
  const raw = program.metadata?.airedUtc;
  if ((typeof raw !== 'string' && typeof raw !== 'number') || raw === '') return null;
  const value = new Date(raw).getTime();
  return Number.isFinite(value) ? value : null;
}

export function isNewsProgramStale(program: Program, nowMs = Date.now()): boolean {
  const aired = airedAtMs(program);
  // Unknown aired times cannot be asserted fresh.
  return aired === null || nowMs - aired > NEWS_STALE_AFTER_MS;
}

export function getNewsFreshness(programs: Program[], nowMs = Date.now()): NewsFreshness {
  const times = programs.map(airedAtMs).filter((value): value is number => value !== null);
  if (!times.length) return { state: 'unknown', latestAiredAt: null };
  const latest = Math.max(...times);
  return {
    state: nowMs - latest > NEWS_STALE_AFTER_MS ? 'stale' : 'fresh',
    latestAiredAt: new Date(latest).toISOString(),
  };
}

export function newsFreshnessBanner(freshness: NewsFreshness): string | null {
  if (freshness.state === 'unknown') return 'News freshness is unavailable';
  if (freshness.state !== 'stale' || !freshness.latestAiredAt) return null;
  const date = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(freshness.latestAiredAt));
  return `Showing recordings from ${date} — newer news not loaded yet`;
}

export function newsTimelineLabel(program: Program, isInCurrentSlot: boolean, nowMs = Date.now()): 'On Air Now' | 'In Rotation' | null {
  if (!isInCurrentSlot) return null;
  return isNewsProgramStale(program, nowMs) ? 'In Rotation' : 'On Air Now';
}
