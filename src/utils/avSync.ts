// Pure rules for "Parallel Audio/Video Sync" (AJN feed items only).
// One episode = one base id (the Radio catalog entry id). Its video twin is `${id}:video`.
// No React, no DOM, no timers: everything here is unit-tested in test-av-sync.ts.
import type { RadioEntry } from './ajnRadioCatalog.ts';

export const VIDEO_SUFFIX = ':video';
export const AVSYNC_STORAGE_KEY = 'ajn.avsync.v1';
export const AVSYNC_MAX_ENTRIES = 200;
/** Below this the position is treated as "start of the episode"; no seek is applied. */
export const AVSYNC_MIN_SECONDS = 1;
/** Within this many seconds of the end, a saved position is ignored (the episode is finished). */
export const AVSYNC_END_GUARD_SECONDS = 2;
/** Mini-player video is re-aligned to the audio when it drifts further than this. */
export const AVSYNC_DRIFT_SECONDS = 0.6;

export function baseIdOf(programId: string | undefined | null): string | null {
  if (!programId) return null;
  return programId.endsWith(VIDEO_SUFFIX) ? programId.slice(0, -VIDEO_SUFFIX.length) : programId;
}
export const videoIdOf = (baseId: string): string => `${baseId}${VIDEO_SUFFIX}`;

export interface MediaTwin {
  entry: RadioEntry;
  /** What the twin is: switching from audio goes to 'video', and from video to 'audio'. */
  target: 'audio' | 'video';
  url: string;
  programId: string;
}

/** The other version of what is playing now, or null when there is none (never guessed: needs a catalog pairing). */
export function twinFor(entries: readonly RadioEntry[], programId: string | undefined | null, mediaType: 'audio' | 'video' | undefined): MediaTwin | null {
  const base = baseIdOf(programId);
  if (!base || !mediaType) return null;
  const entry = entries.find(e => e.id === base);
  if (!entry || !entry.videoUrl || !entry.audioUrl) return null;
  // The id suffix and the media type must agree; otherwise this is not an item we paired.
  const playingVideo = String(programId).endsWith(VIDEO_SUFFIX);
  if (playingVideo !== (mediaType === 'video')) return null;
  return mediaType === 'audio'
    ? { entry, target: 'video', url: entry.videoUrl, programId: videoIdOf(entry.id) }
    : { entry, target: 'audio', url: entry.audioUrl, programId: entry.id };
}

/** Seconds to start the twin at, or null to start from the beginning. */
export function clampStart(seconds: number | null | undefined, duration?: number | null): number | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < AVSYNC_MIN_SECONDS) return null;
  if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0 && seconds >= duration - AVSYNC_END_GUARD_SECONDS) return null;
  return Math.round(seconds * 10) / 10;
}

/** The live playhead wins whenever there is one (even 0: the listener restarted). The saved shared position is only used when no live element exists for this item (e.g. after a reload). */
export function pickSwitchStart(live: number | null | undefined, stored: number | null | undefined, duration?: number | null): number | null {
  if (typeof live === 'number' && Number.isFinite(live)) return clampStart(live, duration);
  return clampStart(stored, duration);
}

export function needsDriftCorrection(slaveSeconds: number, masterSeconds: number, tolerance = AVSYNC_DRIFT_SECONDS): boolean {
  if (!Number.isFinite(slaveSeconds) || !Number.isFinite(masterSeconds)) return false;
  return Math.abs(slaveSeconds - masterSeconds) > tolerance;
}

export interface StoredPosition { seconds: number; updatedAt: number }
export type PositionMap = Record<string, StoredPosition>;
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function parseMap(raw: string | null): PositionMap {
  try {
    const data = JSON.parse(raw ?? '{}');
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    const out: PositionMap = {};
    for (const [id, value] of Object.entries(data as Record<string, unknown>)) {
      const v = value as Partial<StoredPosition> | null;
      if (v && typeof v.seconds === 'number' && Number.isFinite(v.seconds) && v.seconds >= 0 && typeof v.updatedAt === 'number') out[id] = { seconds: v.seconds, updatedAt: v.updatedAt };
    }
    return out;
  } catch { return {}; }
}

/** One shared position per episode (audio and video versions read and write the same record). Storage failures are silent: the live element is still the source of truth. */
export function createPositionStore(storage: StorageLike | null | undefined, now: () => number = Date.now) {
  const load = (): PositionMap => { try { return parseMap(storage?.getItem(AVSYNC_STORAGE_KEY) ?? null); } catch { return {}; } };
  return {
    read(programId: string | undefined | null): number | null {
      const base = baseIdOf(programId);
      return base ? load()[base]?.seconds ?? null : null;
    },
    save(programId: string | undefined | null, seconds: number): boolean {
      const base = baseIdOf(programId);
      if (!base || !Number.isFinite(seconds) || seconds < 0) return false;
      const map = load();
      map[base] = { seconds: Math.round(seconds * 10) / 10, updatedAt: now() };
      const keep = Object.entries(map).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, AVSYNC_MAX_ENTRIES);
      try { storage?.setItem(AVSYNC_STORAGE_KEY, JSON.stringify(Object.fromEntries(keep))); return true; } catch { return false; }
    },
    clear(programId: string | undefined | null): void {
      const base = baseIdOf(programId);
      if (!base) return;
      const map = load();
      if (!(base in map)) return;
      delete map[base];
      try { storage?.setItem(AVSYNC_STORAGE_KEY, JSON.stringify(map)); } catch { /* ignore */ }
    },
  };
}
