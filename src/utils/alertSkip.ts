/* Listen Alerts: the skip tools beside the captions. Pure. Time nudges (-10 s / +10 s / +30 s) go through skipMedia() in podcastSkip.ts
 * (it already stacks rapid taps on the last target); this file adds the same protection for stepping by caption line, and picks the
 * alert hit before / after / at the playhead. */
import type { AlertHit } from './alertMatch.ts';

export const NUDGE_SECONDS = [-10, 10, 30] as const;
/** Same idea as PENDING_SEEK_MS in podcastSkip: taps closer together than this add onto the last target line. */
export const PENDING_CUE_MS = 1200;

export interface CueCursor { target: number; at: number }

/** Line to jump to for a Prev/Next press. `current` is the line the captions say is playing. Rapid presses stack instead of re-reading a
 *  `current` that has not caught up yet. Returns null when there is no line that way (already at the first / last). */
export function stepCue(cursor: CueCursor | null, current: number, dir: -1 | 1, total: number, now: number): { index: number; cursor: CueCursor } | null {
  if (!(total > 0)) return null;
  const base = cursor && now - cursor.at < PENDING_CUE_MS ? cursor.target : current;
  const index = base + dir;
  if (index < 0 || index >= total) return null;
  return { index, cursor: { target: index, at: now } };
}

/** This episode's hits, in transcript order. */
export function hitsForEpisode(hits: readonly AlertHit[], programId: string): AlertHit[] {
  return hits.filter((h) => h.programId === programId).sort((a, b) => a.cueIndex - b.cueIndex);
}
export function nextHit(hits: readonly AlertHit[], cueIndex: number): AlertHit | null { return hits.find((h) => h.cueIndex > cueIndex) ?? null; }
export function prevHit(hits: readonly AlertHit[], cueIndex: number): AlertHit | null { for (let i = hits.length - 1; i >= 0; i--) if (hits[i].cueIndex < cueIndex) return hits[i]; return null; }
/** The hit the listener is "in": the last one at or before the current line. */
export function activeHit(hits: readonly AlertHit[], cueIndex: number): AlertHit | null { for (let i = hits.length - 1; i >= 0; i--) if (hits[i].cueIndex <= cueIndex) return hits[i]; return null; }

/** Lead-in before a hit when playing from a search result: long enough to hear what led up to it, never before the start. */
export const PLAY_LEAD_IN_SECONDS = 8;
export function startAtFor(hit: Pick<AlertHit, 'cueStart'>): number { return Math.max(0, Math.floor(hit.cueStart - PLAY_LEAD_IN_SECONDS)); }

export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.round(sec)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
