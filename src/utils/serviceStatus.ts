/**
 * Pure mapping from real application state to the compact top-row status
 * indicators. No timers, no fetching, no placeholder values: every field is
 * derived from the snapshot passed in, so an indicator can never outlive the
 * state that produced it.
 */
import type { ClientArchiveState, ClientArchivePhase } from '../hooks/useArchiveStatus';
import type { NewsReadySnapshot } from './newsReadyStore';
import { ARCHIVE_PROGRESS_WINDOW_MS } from './archivePlaybackEvidence';

/** ok = green, warn = amber, error = red, neutral = grey (checking / nothing to report). */
export type StatusTone = 'ok' | 'warn' | 'error' | 'neutral';
export type ServiceId = 'news' | 'archive' | 'network';

export interface ServiceIndicator {
  id: ServiceId;
  service: string;
  tone: StatusTone;
  /** Full visible label, e.g. "Archive slow". */
  label: string;
  /** Compact visible label for mid-width headers; always names the service. */
  shortLabel: string;
  /** One-sentence hover/focus tooltip. */
  tooltip: string;
  /** Lines shown in the on-demand report. */
  detail: string[];
  /** Changes only when there is genuinely new content to draw attention to. */
  pulseKey: string | null;
  /** Small count badge (e.g. number of new shows). */
  count: number | null;
}

const clock = (ms: number | null | undefined): string | null => {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return null;
  try {
    return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return null;
  }
};

export interface ArchiveIndicatorInput {
  phase: ClientArchivePhase;
  state: ClientArchiveState;
  since: number | null;
  now: number;
  /** Last time the current Archive item's playhead advanced (null = no evidence). */
  progressAt: number | null;
  windowMs?: number;
}

export function hasRecentArchiveProgress(now: number, progressAt: number | null, windowMs = ARCHIVE_PROGRESS_WINDOW_MS): boolean {
  return progressAt !== null && Number.isFinite(progressAt) && now >= progressAt && now - progressAt <= windowMs;
}

export function describeArchiveStatus(input: ArchiveIndicatorInput): ServiceIndicator {
  const base = { id: 'archive' as const, service: 'Archive', pulseKey: null, count: null };
  const sinceText = clock(input.since);
  const sinceLine = sinceText ? [`Server status since ${sinceText}.`] : [];
  const playing = hasRecentArchiveProgress(input.now, input.progressAt, input.windowMs);

  if (input.phase === 'checking') {
    return {
      ...base, tone: 'neutral', label: 'Archive checking', shortLabel: 'Archive',
      tooltip: 'Checking Archive status…',
      detail: ['Waiting for the first status reply from the app server.'],
    };
  }
  if (input.phase === 'unavailable') {
    return {
      ...base, tone: 'warn', label: 'Archive status unknown', shortLabel: 'Archive',
      tooltip: "Couldn't get Archive status from the app server. Retrying every 30 seconds.",
      detail: [
        "The app server didn't answer the last status check.",
        'This is a status-check problem, not proof that Archive is down. Retrying every 30 seconds.',
      ],
    };
  }

  const serverWord: Record<ClientArchiveState, string> = {
    ok: 'available', degraded: 'slow', down: 'unavailable', unreachable_from_here: 'unavailable', unknown: 'not checked yet',
  };

  // Media that is demonstrably advancing beats a stale server-side verdict.
  if (playing && (input.state === 'degraded' || input.state === 'down' || input.state === 'unreachable_from_here')) {
    return {
      ...base, tone: 'ok', label: 'Archive playing', shortLabel: 'Archive',
      tooltip: 'Archive media is playing now.',
      detail: [
        'The current Archive item is playing (playhead advanced in the last 20 seconds).',
        `The server's last check said Archive was ${serverWord[input.state]}; that may be out of date.`,
        ...sinceLine,
      ],
    };
  }

  switch (input.state) {
    case 'ok':
      return {
        ...base, tone: 'ok', label: 'Archive available', shortLabel: 'Archive',
        tooltip: 'Archive is responding normally.',
        detail: ['Recent Archive requests from the server succeeded.', ...sinceLine],
      };
    case 'degraded':
      return {
        ...base, tone: 'warn', label: 'Archive slow', shortLabel: 'Archive',
        tooltip: 'Some recent Archive requests timed out or failed. Shows may take longer to start.',
        detail: [
          'Some recent Archive requests from the server timed out or failed.',
          'Shows may take longer to start; playback is not interrupted.',
          ...sinceLine,
        ],
      };
    case 'down':
      return {
        ...base, tone: 'error', label: 'Archive unavailable', shortLabel: 'Archive',
        tooltip: "The server couldn't reach Archive recently. Archive shows may not start.",
        detail: [
          "The server couldn't reach Archive recently. Archive shows may not start.",
          'Checking again automatically. Live radio and non-Archive sources are not affected.',
          ...sinceLine,
        ],
      };
    case 'unreachable_from_here':
      return {
        ...base, tone: 'error', label: 'Archive unavailable', shortLabel: 'Archive',
        tooltip: "The app server couldn't reach Archive or its connection check.",
        detail: [
          "The app server couldn't reach Archive or its separate connection check, so the problem is likely the server's own network.",
          'Checking again automatically. This is not about your device’s connection.',
          ...sinceLine,
        ],
      };
    case 'unknown':
    default:
      return {
        ...base, tone: 'neutral', label: 'Archive not checked', shortLabel: 'Archive',
        tooltip: 'No Archive requests yet since the server started.',
        detail: ['The server has not made an Archive request since it started, so there is nothing to report yet.'],
      };
  }
}

export function describeNewsStatus(snapshot: NewsReadySnapshot, intervalMinutes = 5): ServiceIndicator {
  const base = { id: 'news' as const, service: 'News' };
  const checked = clock(snapshot.checkedAt);
  const fetched = clock(snapshot.fetchedAt ? Date.parse(snapshot.fetchedAt) : null);

  if (snapshot.phase === 'ready' && snapshot.newShows.length > 0) {
    const n = snapshot.newShows.length;
    return {
      ...base, tone: 'ok', label: 'News ready', shortLabel: 'News',
      tooltip: `${n} new news show${n === 1 ? '' : 's'} ready. Click to see them.`,
      detail: [
        `${n} new show${n === 1 ? '' : 's'} since you opened the app${fetched ? ` (fetched ${fetched})` : ''}.`,
        'Nothing plays until you choose a show.',
      ],
      pulseKey: `news-${snapshot.version}`,
      count: n,
    };
  }
  if (snapshot.phase === 'error') {
    return {
      ...base, tone: 'warn', label: 'News delayed', shortLabel: 'News',
      tooltip: `Couldn't check for new news. Next try in ${intervalMinutes} minutes.`,
      detail: [
        `The last news check failed${checked ? ` at ${checked}` : ''}. Next try in ${intervalMinutes} minutes.`,
        'Shows already in the guide still play.',
      ],
      pulseKey: null, count: null,
    };
  }
  if (snapshot.phase === 'checking') {
    return {
      ...base, tone: 'neutral', label: 'News checking', shortLabel: 'News',
      tooltip: 'Checking for new news…',
      detail: ['Waiting for the first news check.'],
      pulseKey: null, count: null,
    };
  }
  if (snapshot.refreshing) {
    return {
      ...base, tone: 'neutral', label: 'News updating', shortLabel: 'News',
      tooltip: 'The server is fetching new news in the background.',
      detail: ['The server is fetching new news in the background. You’ll see “News ready” when new shows arrive.'],
      pulseKey: null, count: null,
    };
  }
  return {
    ...base, tone: 'neutral', label: 'News current', shortLabel: 'News',
    tooltip: 'No new news since you opened the app.',
    detail: [`No new news shows since you opened the app${checked ? ` (checked ${checked})` : ''}.`],
    pulseKey: null, count: null,
  };
}

/** Rendered only while the device reports it is offline. */
export function describeNetworkStatus(online: boolean): ServiceIndicator | null {
  if (online) return null;
  return {
    id: 'network', service: 'Connection', tone: 'error', label: 'Offline', shortLabel: 'Offline',
    tooltip: 'This device reports no network connection.',
    detail: [
      'This device reports no network connection.',
      'Playback picks up again when the connection returns.',
    ],
    pulseKey: null, count: null,
  };
}

/** Text a screen reader hears when an indicator changes. */
export function announcementFor(indicator: ServiceIndicator): string {
  return `${indicator.service} status: ${indicator.label}.`;
}
