// Picks up to `max` non-overlapping consecutive caption-minute windows from ONE program, best first.
// Pure, deterministic, no I/O. Uses scoreMinute from excerptScore.ts; source wording is never altered.
import { scoreMinute, type ExcerptPick, type ScoreMinute } from './excerptScore.js';

export const DEFAULT_WINDOW_MINUTES = 2;
export const DEFAULT_MAX_WINDOWS = 3;
/** Same threshold excerptScore.ts uses for `lowSignal`: windows below it are dropped, not shown as weak picks. */
export const DEFAULT_MIN_WINDOW_SCORE = 30;

interface Candidate { startIdx: number; endIdx: number; startSec: number; score: number }

export function pickTopWindows(
  minutes: readonly ScoreMinute[],
  count: number = DEFAULT_WINDOW_MINUTES,
  max: number = DEFAULT_MAX_WINDOWS,
  minScore: number = DEFAULT_MIN_WINDOW_SCORE,
): ExcerptPick[] {
  if (!Array.isArray(minutes) || count < 1 || max < 1 || minutes.length < count) return [];
  const sorted = minutes.slice().sort((a, b) => a.startSec - b.startSec);
  const scores = sorted.map((m) => scoreMinute(m));
  const candidates: Candidate[] = [];
  for (let i = 0; i + count <= sorted.length; i++) {
    let contiguous = true;
    let sum = 0;
    for (let k = 0; k < count; k++) {
      if (scores[i + k] <= -100) { contiguous = false; break; }
      if (k > 0 && sorted[i + k].startSec - sorted[i + k - 1].startSec !== 60) { contiguous = false; break; }
      sum += scores[i + k];
    }
    if (!contiguous || sum < minScore) continue;
    candidates.push({ startIdx: i, endIdx: i + count, startSec: sorted[i].startSec, score: sum });
  }
  candidates.sort((a, b) => b.score - a.score || a.startSec - b.startSec);
  const picked: Candidate[] = [];
  for (const c of candidates) {
    if (picked.length >= max) break;
    if (!picked.some((p) => c.startIdx < p.endIdx && p.startIdx < c.endIdx)) picked.push(c);
  }
  return picked.map((p) => ({
    minutes: sorted.slice(p.startIdx, p.endIdx).map((m) => ({ clock: m.clock, startSec: m.startSec, text: m.text })),
    score: p.score,
    lowSignal: false,
  }));
}
