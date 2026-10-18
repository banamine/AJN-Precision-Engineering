export const VIDEO_PREFETCH_RANGE = 'bytes=0-1048575';
export const VIDEO_PREFETCH_MAX_BYTES = 1024 * 1024;
export const VIDEO_PREFETCH_PAUSE_CANCEL_MS = 5 * 60 * 1000;

export type VideoPrefetchOutcome =
  | 'completed'
  | 'rate-limited'
  | 'server-error'
  | 'http-error'
  | 'invalid-range'
  | 'oversize'
  | 'aborted'
  | 'cancelled-hidden'
  | 'cancelled-buffering'
  | 'cancelled-pause';

export interface VideoPrefetchTarget {
  src: string;
  mediaType: string;
  guideId?: string;
  channelId?: string;
  programId?: string;
}

export interface VideoPrefetchTelemetry {
  event: 'playback.prefetch';
  guideId: string | null;
  channelId: string | null;
  programId: string | null;
  mediaPath: null;
  nextPath: string;
  bytes: number;
  ms: number;
  outcome: VideoPrefetchOutcome;
}

export interface PrefetchMedia {
  currentTime: number;
  duration: number;
  paused: boolean;
  ended: boolean;
  readyState: number;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface PrefetchVisibility {
  readonly hidden: boolean;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

export interface PrefetchTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ArchiveVideoPrefetchOptions {
  media: PrefetchMedia;
  currentSrc: string;
  currentMediaType: string;
  currentGuideId?: string;
  currentChannelId?: string;
  currentProgramId?: string;
  isHls?: boolean;
  resolveNext: () => Promise<VideoPrefetchTarget | null>;
  saveData?: () => boolean;
  visibility?: PrefetchVisibility;
  fetcher?: typeof fetch;
  timers?: PrefetchTimers;
  now?: () => number;
  onTelemetry?: (event: VideoPrefetchTelemetry) => void;
}

const DEFAULT_TIMERS: PrefetchTimers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** True only for an unsigned same-origin AJN Archive proxy URL to a /download path. */
export function isArchiveProxyPath(value: string): boolean {
  if (!value.startsWith('/api/archive/proxy?')) return false;
  try {
    const url = new URL(value, 'https://ajn.invalid');
    if (url.origin !== 'https://ajn.invalid' || url.pathname !== '/api/archive/proxy' || url.hash) return false;
    if (url.searchParams.getAll('path').length !== 1 || [...url.searchParams.keys()].some((key) => key !== 'path')) return false;
    const path = url.searchParams.get('path');
    if (!path || !path.startsWith('/download/') || /[?#]/.test(path)) return false;
    const parts = path.split('/');
    return parts.length >= 4 && parts[2].length > 0 && parts.slice(3).join('/').length > 0
      && !parts.some((part) => part === '.' || part === '..')
      && !/\.m3u8$/i.test(path);
  } catch {
    return false;
  }
}

function thresholdReached(media: PrefetchMedia): boolean {
  const duration = media.duration;
  const current = media.currentTime;
  return Number.isFinite(duration) && duration > 0 && Number.isFinite(current) && current >= 0
    && (current / duration >= 0.6 || duration - current <= 90);
}

function defaultSaveData(): boolean {
  if (typeof navigator === 'undefined') return false;
  return Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
}

async function consumeAtMostOneMiB(response: Response, signal: AbortSignal): Promise<{ bytes: number; outcome?: VideoPrefetchOutcome }> {
  const contentRange = response.headers.get('content-range');
  const rangeMatch = contentRange?.match(/^bytes 0-(\d+)\/(?:\d+|\*)$/i);
  if (response.status !== 206 || !rangeMatch || Number(rangeMatch[1]) >= VIDEO_PREFETCH_MAX_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    return { bytes: 0, outcome: 'invalid-range' };
  }
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null && Number(declaredLength) > VIDEO_PREFETCH_MAX_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    return { bytes: 0, outcome: 'oversize' };
  }
  if (!response.body) return { bytes: 0, outcome: 'invalid-range' };
  const reader = response.body.getReader();
  let bytes = 0;
  try {
    while (!signal.aborted) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > VIDEO_PREFETCH_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { bytes, outcome: 'oversize' };
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (signal.aborted) return { bytes, outcome: 'aborted' };
  return { bytes };
}

/**
 * Attach a one-item-ahead, low-priority first-slice warmup to the authoritative
 * media element. The controller never creates a media element and never retries.
 */
export function attachArchiveVideoPrefetch(options: ArchiveVideoPrefetchOptions): () => void {
  const { media } = options;
  const visibility = options.visibility ?? (typeof document === 'undefined' ? undefined : document);
  const timers = options.timers ?? DEFAULT_TIMERS;
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => performance.now());
  const saveData = options.saveData ?? defaultSaveData;
  let stallActive = false;
  let attempted = false;
  let disposed = false;
  let pauseTimer: unknown;
  let requestController: AbortController | null = null;
  let requestPath = '';
  let requestStartedAt = 0;
  let reported = false;

  const report = (outcome: VideoPrefetchOutcome, bytes = 0) => {
    if (reported || !requestPath) return;
    reported = true;
    options.onTelemetry?.({
      event: 'playback.prefetch',
      guideId: options.currentGuideId ?? null,
      channelId: options.currentChannelId ?? null,
      programId: options.currentProgramId ?? null,
      mediaPath: null,
      nextPath: requestPath,
      bytes,
      ms: Math.max(0, Math.round(now() - requestStartedAt)),
      outcome,
    });
  };

  const abortActive = (outcome: VideoPrefetchOutcome) => {
    if (!requestController || requestController.signal.aborted) return;
    requestController.abort();
    report(outcome);
  };

  const eligibleCurrent = () => options.currentMediaType === 'video'
    && !options.isHls
    && isArchiveProxyPath(options.currentSrc)
    && !saveData();

  const maybeStart = () => {
    if (disposed || attempted || requestController || !eligibleCurrent() || media.paused || media.ended
      || media.readyState < 3 || stallActive || visibility?.hidden || !thresholdReached(media)) return;
    attempted = true;
    const controller = new AbortController();
    requestController = controller;
    requestStartedAt = now();
    void (async () => {
      try {
        const target = await options.resolveNext();
        if (disposed || controller.signal.aborted) return;
        if (!target
          || target.mediaType !== 'video'
          || !options.currentGuideId
          || !options.currentChannelId
          || target.guideId !== options.currentGuideId
          || target.channelId !== options.currentChannelId
          || !isArchiveProxyPath(target.src)
          || target.src === options.currentSrc
          || !eligibleCurrent()
          || media.paused || media.ended || media.readyState < 3 || stallActive || visibility?.hidden) {
          requestController = null;
          return;
        }
        requestPath = target.src;
        const response = await fetcher(target.src, {
          method: 'GET',
          headers: { Range: 'bytes=0-1048575' },
          signal: controller.signal,
          cache: 'default',
          priority: 'low',
        } as RequestInit & { priority: 'low' });
        if (response.status === 429) {
          await response.body?.cancel().catch(() => undefined);
          report('rate-limited');
          return;
        }
        if (response.status >= 500) {
          await response.body?.cancel().catch(() => undefined);
          report('server-error');
          return;
        }
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          report('http-error');
          return;
        }
        const result = await consumeAtMostOneMiB(response, controller.signal);
        report(result.outcome ?? 'completed', result.bytes);
      } catch {
        report(controller.signal.aborted ? 'aborted' : 'http-error');
      } finally {
        if (requestController === controller) requestController = null;
      }
    })();
  };

  const onTimeUpdate = () => maybeStart();
  const onPlaying = () => { stallActive = false; maybeStart(); };
  const onCanPlay = () => { if (media.readyState >= 3) { stallActive = false; maybeStart(); } };
  const onProgress = () => { if (media.readyState >= 3) stallActive = false; };
  const onBuffering = () => {
    stallActive = true;
    abortActive('cancelled-buffering');
  };
  const onPause = () => {
    if (pauseTimer !== undefined) timers.clearTimeout(pauseTimer);
    pauseTimer = timers.setTimeout(() => {
      pauseTimer = undefined;
      if (media.paused) abortActive('cancelled-pause');
    }, VIDEO_PREFETCH_PAUSE_CANCEL_MS);
  };
  const onPlay = () => {
    if (pauseTimer !== undefined) timers.clearTimeout(pauseTimer);
    pauseTimer = undefined;
    maybeStart();
  };
  const onVisibility = () => {
    if (visibility?.hidden) abortActive('cancelled-hidden');
    else maybeStart();
  };

  media.addEventListener('timeupdate', onTimeUpdate);
  media.addEventListener('playing', onPlaying);
  media.addEventListener('canplay', onCanPlay);
  media.addEventListener('progress', onProgress);
  media.addEventListener('waiting', onBuffering);
  media.addEventListener('stalled', onBuffering);
  media.addEventListener('pause', onPause);
  media.addEventListener('play', onPlay);
  media.addEventListener('ended', onBuffering);
  visibility?.addEventListener('visibilitychange', onVisibility);

  return () => {
    if (disposed) return;
    disposed = true;
    if (pauseTimer !== undefined) timers.clearTimeout(pauseTimer);
    pauseTimer = undefined;
    abortActive('aborted');
    media.removeEventListener('timeupdate', onTimeUpdate);
    media.removeEventListener('playing', onPlaying);
    media.removeEventListener('canplay', onCanPlay);
    media.removeEventListener('progress', onProgress);
    media.removeEventListener('waiting', onBuffering);
    media.removeEventListener('stalled', onBuffering);
    media.removeEventListener('pause', onPause);
    media.removeEventListener('play', onPlay);
    media.removeEventListener('ended', onBuffering);
    visibility?.removeEventListener('visibilitychange', onVisibility);
  };
}
