// One place that follows the media element inside #persistent-player (the single player that stays mounted across pages).
// Used by the mini dock and the Radio "Now Playing" panel. It only READS and drives that element; it never creates one.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MediaType } from '../types';

export interface PersistentMediaState {
  /** True when there is no element yet or it is paused. */
  paused: boolean;
  currentTime: number;
  /** 0 until the element reports a finite duration (live streams stay 0). */
  duration: number;
  /** An element exists in #persistent-player. */
  attached: boolean;
}

export interface PersistentMedia extends PersistentMediaState {
  toggle: () => void;
  seek: (seconds: number) => void;
}

export function findPersistentMedia(mediaType?: MediaType): HTMLMediaElement | null {
  const audio = () => document.querySelector<HTMLMediaElement>('#persistent-player audio');
  const video = () => document.querySelector<HTMLMediaElement>('#persistent-player video');
  return mediaType === 'audio' ? audio() ?? video() : video() ?? audio();
}

const EVENTS = ['play', 'pause', 'timeupdate', 'durationchange', 'loadedmetadata', 'ended', 'emptied'] as const;
const IDLE: PersistentMediaState = { paused: true, currentTime: 0, duration: 0, attached: false };

/** `sourceKey` should change whenever a different item is loaded (the element is replaced when the source changes). */
export function usePersistentMedia(mediaType: MediaType | undefined, sourceKey: string | undefined, enabled = true): PersistentMedia {
  const [state, setState] = useState<PersistentMediaState>(IDLE);
  const mediaRef = useRef<HTMLMediaElement | null>(null);

  useEffect(() => {
    if (!enabled) { mediaRef.current = null; setState(IDLE); return; }
    let media: HTMLMediaElement | null = null;
    const read = () => {
      const next: PersistentMediaState = media
        ? { paused: media.paused, currentTime: Number.isFinite(media.currentTime) ? media.currentTime : 0, duration: Number.isFinite(media.duration) ? media.duration : 0, attached: true }
        : IDLE;
      setState(prev => (prev.paused === next.paused && Math.floor(prev.currentTime) === Math.floor(next.currentTime) && prev.duration === next.duration && prev.attached === next.attached ? prev : next));
    };
    const detach = () => { if (media) for (const e of EVENTS) media.removeEventListener(e, read); };
    const attach = () => {
      const next = findPersistentMedia(mediaType);
      if (next === media) return;
      detach();
      media = next; mediaRef.current = next;
      if (media) for (const e of EVENTS) media.addEventListener(e, read);
      read();
    };
    attach();
    const timer = window.setInterval(attach, 250);
    return () => { window.clearInterval(timer); detach(); mediaRef.current = null; };
  }, [mediaType, sourceKey, enabled]);

  const toggle = useCallback(() => {
    const media = mediaRef.current ?? findPersistentMedia(mediaType);
    if (!media) return;
    if (media.paused) void media.play().catch(() => {}); else media.pause();
  }, [mediaType]);
  const seek = useCallback((seconds: number) => {
    const media = mediaRef.current ?? findPersistentMedia(mediaType);
    if (!media || !Number.isFinite(seconds)) return;
    const max = Number.isFinite(media.duration) ? media.duration : seconds;
    media.currentTime = Math.max(0, Math.min(seconds, max));
  }, [mediaType]);
  return { ...state, toggle, seek };
}
