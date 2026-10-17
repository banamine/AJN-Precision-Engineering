// Pure logic for the Police Chase reel (Home, row 4): which clips, in what order, where a preview starts, who may play.
import type { Program, ScheduleChannel } from '../types';

export const POLICE_CHASE_CHANNEL_ID = 'fox-clips-police-chase';
export const PREVIEW_SECONDS = 6;      // each preview runs this long, then jumps to another random point
export const MAX_PLAYING = 3;          // previews playing at once (bandwidth + decoder budget)

export interface ReelClip { key: string; program: Program; title: string; url: string; seconds: number; thumb?: string; uploaded?: string }

/** One entry per clip (the schedule repeats clips through the day), only direct https MP4s. */
export function clipsFromChannels(channels: ScheduleChannel[]): ReelClip[] {
  const ch = channels.find((c) => c.id === POLICE_CHASE_CHANNEL_ID);
  if (!ch) return [];
  const seen = new Set<string>();
  const out: ReelClip[] = [];
  for (const p of ch.programs ?? []) {
    const key = String(p.id).split(':d')[0];
    const url = String(p.mediaUrl ?? '');
    const m = (p.metadata ?? {}) as { durationSeconds?: number; thumb?: string; uploaded?: string };
    if (seen.has(key) || !/^https:\/\/[^\s]+\.mp4(\?|$)/i.test(url)) continue;
    seen.add(key);
    out.push({ key, program: p, title: p.title, url, seconds: Number(m.durationSeconds) || 0, ...(m.thumb ? { thumb: m.thumb } : {}), ...(m.uploaded ? { uploaded: m.uploaded } : {}) });
  }
  return out;
}

/** Fisher-Yates with an injectable random source (tests pass a seeded one). */
export function shuffled<T>(items: readonly T[], rand: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Random start inside the clip: skips the first/last 5% (titles, tails) and always leaves room for a whole preview. */
export function previewStart(durationSeconds: number, rand: () => number = Math.random, previewSeconds = PREVIEW_SECONDS): number {
  if (!(durationSeconds > previewSeconds + 1)) return 0;
  const lo = durationSeconds * 0.05;
  const hi = Math.max(lo, durationSeconds * 0.95 - previewSeconds);
  return Math.round((lo + rand() * (hi - lo)) * 10) / 10;
}

/** The first `max` visible cards, in on-screen order, may play; everything else stays still. */
export function pickPlaying(visible: ReadonlySet<string>, order: readonly string[], max = MAX_PLAYING): Set<string> {
  const out = new Set<string>();
  for (const k of order) { if (out.size >= max) break; if (visible.has(k)) out.add(k); }
  return out;
}

/** Slow ping-pong auto-scroll step: returns the next scrollLeft and direction. */
export function scrollStep(pos: number, dir: 1 | -1, max: number, px: number): { pos: number; dir: 1 | -1 } {
  if (max <= 0) return { pos: 0, dir };
  let next = pos + dir * px;
  if (next >= max) return { pos: max, dir: -1 };
  if (next <= 0) return { pos: 0, dir: 1 };
  return { pos: next, dir };
}
