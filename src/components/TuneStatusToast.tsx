import { ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import type { Destination, NowPlayingMedia } from '../types';
import { findPersistentMedia, togglePersistentMedia } from '../hooks/usePersistentMedia';
import {
  ERROR_GRACE_MS,
  PLAYING_HIDE_MS,
  SLOW_MS,
  TuneEvent,
  TuneStatus,
  nextTuneStatus,
} from '../utils/tuneStatus';

const ENABLE_TUNE_TOAST = false;

interface TuneStatusToastProps {
  nowPlaying: NowPlayingMedia | null;
  destination?: Destination;
}

const isRadioMedia = (m: NowPlayingMedia | null): boolean => {
  if (!m || m.mediaType !== 'audio') return false;
  return Boolean(
    m.isLive ||
      String(m.channelId ?? '').startsWith('radio:') ||
      String(m.programId ?? '').includes(':live:')
  );
};

function TuneStatusToastInner({ nowPlaying }: TuneStatusToastProps): ReactElement | null {
  const [status, setStatus] = useState<TuneStatus>({ kind: 'idle' });
  const isFirstMountRef = useRef<boolean>(true);
  const currentMediaRef = useRef<HTMLMediaElement | null>(null);
  const errorTimerRef = useRef<number | null>(null);
  const slowTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  const clearAllTimers = useCallback(() => {
    if (errorTimerRef.current !== null) {
      window.clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
    if (slowTimerRef.current !== null) {
      window.clearTimeout(slowTimerRef.current);
      slowTimerRef.current = null;
    }
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const dispatch = useCallback((e: TuneEvent) => {
    setStatus((prev) => nextTuneStatus(prev, e));
  }, []);

  const onPlaying = useCallback(() => {
    if (errorTimerRef.current !== null) {
      window.clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
    if (slowTimerRef.current !== null) {
      window.clearTimeout(slowTimerRef.current);
      slowTimerRef.current = null;
    }
    dispatch({ type: 'playing' });
  }, [dispatch]);

  const onError = useCallback(() => {
    if (errorTimerRef.current !== null) {
      window.clearTimeout(errorTimerRef.current);
    }
    errorTimerRef.current = window.setTimeout(() => {
      errorTimerRef.current = null;
      const media = currentMediaRef.current ?? findPersistentMedia('audio');
      if (media && media.error) {
        dispatch({ type: 'error' });
      }
    }, ERROR_GRACE_MS);
  }, [dispatch]);

  const attachMedia = useCallback(
    (el: HTMLMediaElement | null) => {
      if (currentMediaRef.current === el) return;
      if (currentMediaRef.current) {
        currentMediaRef.current.removeEventListener('playing', onPlaying);
        currentMediaRef.current.removeEventListener('error', onError);
      }
      currentMediaRef.current = el;
      if (el) {
        el.addEventListener('playing', onPlaying);
        el.addEventListener('error', onError);
      }
    },
    [onPlaying, onError]
  );

  useEffect(() => {
    const target = document.querySelector('#persistent-player');
    attachMedia(findPersistentMedia('audio'));

    let observer: MutationObserver | null = null;
    if (target && typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(() => {
        attachMedia(findPersistentMedia('audio'));
      });
      observer.observe(target, { childList: true, subtree: true });
    }

    return () => {
      if (observer) observer.disconnect();
      attachMedia(null);
      clearAllTimers();
    };
  }, [attachMedia, clearAllTimers]);

  useEffect(() => {
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false;
      return;
    }

    if (!isRadioMedia(nowPlaying) || !nowPlaying) {
      return;
    }

    clearAllTimers();
    const label = nowPlaying.title || 'Radio';
    dispatch({ type: 'tune', label });

    slowTimerRef.current = window.setTimeout(() => {
      slowTimerRef.current = null;
      dispatch({ type: 'slow' });
    }, SLOW_MS);
  }, [nowPlaying, clearAllTimers, dispatch]);

  useEffect(() => {
    if (status.kind === 'playing') {
      hideTimerRef.current = window.setTimeout(() => {
        hideTimerRef.current = null;
        dispatch({ type: 'dismiss' });
      }, PLAYING_HIDE_MS);
    } else if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, [status, dispatch]);

  const handleRetry = useCallback(() => {
    const media = currentMediaRef.current ?? findPersistentMedia('audio');
    if (!media) return;
    if (media.error) {
      media.load();
      void media.play().catch(() => {});
      return;
    }
    togglePersistentMedia(media);
  }, []);

  const handleDismiss = useCallback(() => {
    clearAllTimers();
    dispatch({ type: 'dismiss' });
  }, [clearAllTimers, dispatch]);

  if (status.kind === 'idle') {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="tune-status-toast"
      className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] pointer-events-none max-w-md w-auto px-4 py-2.5 rounded-xl border border-neutral-700/80 bg-neutral-900/95 text-neutral-100 shadow-2xl backdrop-blur-md flex items-center gap-3 transition-opacity duration-200 motion-reduce:transition-none"
    >
      {status.kind === 'tuning' && (
        <div className="flex items-center gap-2">
          <span>Tuning to {status.label}…</span>
          <button
            type="button"
            onClick={handleDismiss}
            className="pointer-events-auto px-2 py-1 text-xs font-semibold rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}
      {status.kind === 'slow' && (
        <div className="flex items-center gap-2">
          <span>Still connecting to {status.label}…</span>
          <button
            type="button"
            onClick={handleDismiss}
            className="pointer-events-auto px-2 py-1 text-xs font-semibold rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}
      {status.kind === 'playing' && <span>Playing {status.label}</span>}
      {status.kind === 'error' && (
        <div className="flex items-center gap-2">
          <span>Couldn't play {status.label}</span>
          <button
            type="button"
            onClick={handleRetry}
            className="pointer-events-auto px-2.5 py-1 text-xs font-semibold rounded-md bg-sky-600 hover:bg-sky-500 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 cursor-pointer"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="pointer-events-auto px-2 py-1 text-xs font-semibold rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

export function TuneStatusToast(props: TuneStatusToastProps): ReactElement | null {
  if (!ENABLE_TUNE_TOAST) {
    return null;
  }
  return <TuneStatusToastInner {...props} />;
}
