// Parallel Audio/Video Sync for AJN feed items (channel 'ajn-radio').
//  - useAvSyncRecorder: saves the playhead (shared by the audio and video version of an episode) about once a second.
//  - useAjnTwin:        finds the paired other-media version from the Radio catalog (never guessed).
//  - useAvSwitch:       Hard Switch (swap the main player at the same second) and the Mini Video overlay.
// It READS the one element in #persistent-player; it never creates a player or an AudioContext.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Destination, NowPlayingMedia, PlayProgramCallback } from '../types';
import { loadAjnFeeds } from '../services/ajnFeeds';
import { buildRadioCatalog, type RadioEntry } from '../utils/ajnRadioCatalog';
import { AJN_CHANNEL_LABELS } from '../utils/ajnClassify';
import { baseIdOf, createPositionStore, pickSwitchStart, twinFor, type MediaTwin, AVSYNC_MIN_SECONDS } from '../utils/avSync';
import { pipStore, usePip } from '../utils/avSyncPip';
import { findPersistentMedia } from './usePersistentMedia';

export const AJN_SYNC_CHANNEL = 'ajn-radio';
const SAVE_INTERVAL_MS = 1000;
const CATALOG_TTL_MS = 10 * 60 * 1000;

function browserStorage(): Storage | null { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } }
export const positionStore = createPositionStore(browserStorage());

export const isSyncable = (nowPlaying: NowPlayingMedia | null | undefined): nowPlaying is NowPlayingMedia =>
  Boolean(nowPlaying && nowPlaying.channelId === AJN_SYNC_CHANNEL && nowPlaying.programId && (nowPlaying.mediaType === 'audio' || nowPlaying.mediaType === 'video'));

let catalogCache: { at: number; promise: Promise<RadioEntry[]> } | null = null;
function loadEntries(): Promise<RadioEntry[]> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.promise;
  const promise = loadAjnFeeds(new AbortController().signal)
    .then(({ items }) => { const c = buildRadioCatalog(items.filter(i => i.url).map(i => ({ id: i.id, title: i.title, url: i.url!, mediaType: i.mediaType, publishedAt: i.publishedAt }))); return [...c.radio, ...c.exclusive]; })
    .catch(error => { catalogCache = null; throw error; }); // a failed lookup is never cached as "no twin"
  catalogCache = { at: Date.now(), promise };
  return promise;
}

/** Records the shared position while an AJN item plays. Mount once (App). */
export function useAvSyncRecorder(nowPlaying: NowPlayingMedia | null | undefined): void {
  const programId = isSyncable(nowPlaying) ? nowPlaying.programId : undefined;
  const mediaType = nowPlaying?.mediaType;
  const src = nowPlaying?.src;
  useEffect(() => {
    if (!programId) return;
    let media: HTMLMediaElement | null = null;
    let lastSave = 0;
    const save = (force: boolean) => {
      if (!media || !Number.isFinite(media.currentTime) || media.readyState < 1) return;
      const now = Date.now();
      if (!force && now - lastSave < SAVE_INTERVAL_MS) return;
      if (Number.isFinite(media.duration) && media.duration > 0 && media.currentTime >= media.duration - 2) { positionStore.clear(programId); return; }
      if (media.currentTime < AVSYNC_MIN_SECONDS) return;
      lastSave = now;
      positionStore.save(programId, media.currentTime);
    };
    const onTime = () => { if (!media?.paused) save(false); };
    const onPause = () => save(true);
    const onEnded = () => positionStore.clear(programId);
    const onHide = () => { if (document.visibilityState === 'hidden') save(true); };
    const detach = () => { media?.removeEventListener('timeupdate', onTime); media?.removeEventListener('pause', onPause); media?.removeEventListener('ended', onEnded); };
    const attach = () => {
      const next = findPersistentMedia(mediaType);
      if (next === media) return;
      detach(); media = next;
      media?.addEventListener('timeupdate', onTime); media?.addEventListener('pause', onPause); media?.addEventListener('ended', onEnded);
    };
    attach();
    const timer = window.setInterval(attach, 250);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPause);
    return () => { save(true); window.clearInterval(timer); detach(); document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', onPause); };
  }, [programId, mediaType, src]);
}

export function useAjnTwin(nowPlaying: NowPlayingMedia | null | undefined): MediaTwin | null {
  const syncable = isSyncable(nowPlaying);
  const programId = syncable ? nowPlaying.programId : undefined;
  const mediaType = syncable ? nowPlaying.mediaType : undefined;
  const [entries, setEntries] = useState<RadioEntry[] | null>(null);
  useEffect(() => {
    if (!syncable) { setEntries(null); return; }
    let live = true;
    loadEntries().then(list => { if (live) setEntries(list); }).catch(() => { if (live) setEntries(null); });
    return () => { live = false; };
  }, [syncable]);
  return useMemo(() => (entries ? twinFor(entries, programId, mediaType as 'audio' | 'video' | undefined) : null), [entries, programId, mediaType]);
}

export interface AvSwitch {
  twin: MediaTwin | null;
  /** The mini video overlay is open for the current episode. */
  miniOpen: boolean;
  /** Mini overlay is only offered while audio is the main player. */
  canMini: boolean;
  hardSwitch: () => void;
  toggleMini: () => void;
}

export function useAvSwitch(nowPlaying: NowPlayingMedia | null | undefined, onPlay: PlayProgramCallback | undefined, onNavigate?: (destination: Destination) => void): AvSwitch {
  const twin = useAjnTwin(nowPlaying);
  const pip = usePip();
  const base = baseIdOf(nowPlaying?.programId);
  const miniOpen = Boolean(pip && base && pip.programId === base);
  const canMini = Boolean(twin && twin.target === 'video');

  const hardSwitch = useCallback(() => {
    if (!twin || !nowPlaying || !onPlay) return;
    const media = findPersistentMedia(nowPlaying.mediaType);
    const live = media && media.readyState >= 1 && Number.isFinite(media.currentTime) ? media.currentTime : null;
    const duration = media && Number.isFinite(media.duration) ? media.duration : null;
    if (live !== null && live >= AVSYNC_MIN_SECONDS) positionStore.save(nowPlaying.programId, live);
    const start = pickSwitchStart(live, positionStore.read(nowPlaying.programId), duration);
    pipStore.close();
    onPlay(twin.url, twin.entry.title, AJN_CHANNEL_LABELS[twin.entry.channel], twin.target, AJN_SYNC_CHANNEL, AJN_SYNC_CHANNEL, twin.programId, undefined, undefined, start ?? undefined);
    if (twin.target === 'video') onNavigate?.('player'); // Watch = the main view becomes the video player
  }, [twin, nowPlaying, onPlay, onNavigate]);

  const toggleMini = useCallback(() => {
    if (!twin || twin.target !== 'video') return;
    if (miniOpen) { pipStore.close(); return; }
    pipStore.open({ programId: twin.entry.id, src: twin.url, title: twin.entry.title });
  }, [twin, miniOpen]);

  // The overlay belongs to one audio episode: closing/changing the episode (or switching the main player to video) removes it.
  useEffect(() => {
    if (!pip) return;
    if (!nowPlaying || nowPlaying.mediaType !== 'audio' || baseIdOf(nowPlaying.programId) !== pip.programId) pipStore.close();
  }, [pip, nowPlaying]);

  return { twin, miniOpen, canMini, hardSwitch, toggleMini };
}
