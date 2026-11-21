/* Caption sync for podcast episodes. Pure: no React, no network, no audio element.
 *
 * Two clocks: the SHOW clock (the clean episode; transcript and ad map use it) and the FILE clock (the served download, which
 * has ads stitched in and differs per download). The ad map says where each break sits on the show clock; the file clock position
 * of a break = its show position + the ad seconds before it. Offsets per show segment: o[j] = file - show for segment j.
 *
 *   o[0] = 0, o[j+1] = o[j] + length of break j      (estimated lengths from the ad budget: up to ~66 s off on long breaks)
 *
 * A LOCK replaces one segment's offset with a measured one (Part 2: transcript pauses matched to real audio silences, or a
 * listener tapping the line they hear). Offsets after a locked segment are recomputed from it. Ads sit at fixed places in the
 * file, so a lock stays valid after the listener seeks inside the same segment. */
import type { Cue } from './transcriptParse';
import type { PodEstimate, PodKind } from './podcastAdSkip';

/* ---------- timeline ---------- */
export interface Timeline { clean: number; bounds: number[]; lens: number[]; kinds: PodKind[] }
export function buildTimeline(est: readonly PodEstimate[], clean: number): Timeline {
  const sorted = [...est].sort((a, b) => a.cleanAt - b.cleanAt);
  return { clean, bounds: sorted.map((e) => e.cleanAt), lens: sorted.map((e) => e.length), kinds: sorted.map((e) => e.kind) };
}
export type Locks = ReadonlyMap<number, number>;
/** o[0..P]: file minus show for each show segment. A lock on j wins over the estimate. */
export function offsetsOf(tl: Timeline, locks: Locks): number[] {
  const o: number[] = [];
  for (let j = 0; j <= tl.bounds.length; j++) {
    const locked = locks.get(j);
    o.push(locked !== undefined ? locked : j === 0 ? 0 : o[j - 1] + tl.lens[j - 1]);
  }
  return o;
}
export const segFrom = (tl: Timeline, j: number) => (j === 0 ? 0 : tl.bounds[j - 1]);
export const segTo = (tl: Timeline, j: number) => (j < tl.bounds.length ? tl.bounds[j] : tl.clean);

export type Where =
  | { kind: 'show'; show: number; seg: number }
  | { kind: 'ad'; pod: number; into: number; length: number };

/** Where a file position falls: inside the show (and at what show time) or inside an ad break. */
export function locate(t: number, tl: Timeline, o: readonly number[]): Where {
  const P = tl.bounds.length;
  for (let j = 0; j <= P; j++) {
    const a = o[j] + segFrom(tl, j); const b = o[j] + segTo(tl, j);
    if (t >= a && t < b) return { kind: 'show', show: t - o[j], seg: j };
    if (j < P) {
      const ps = o[j] + tl.bounds[j]; const pe = o[j + 1] + tl.bounds[j];
      if (t >= ps && t < Math.max(ps, pe)) return { kind: 'ad', pod: j, into: t - ps, length: Math.max(0, pe - ps) };
    }
  }
  // past the last segment (or a gap from inconsistent locks): the nearest segment that starts before t
  let best = 0;
  for (let j = 0; j <= P; j++) if (o[j] + segFrom(tl, j) <= t) best = j;
  return { kind: 'show', show: Math.min(Math.max(t - o[best], 0), tl.clean), seg: best };
}
/** File time of a show time (for tap-to-jump and the sponsor skip). */
export function showToFile(show: number, tl: Timeline, o: readonly number[]): number {
  let j = 0;
  for (let k = 0; k <= tl.bounds.length; k++) if (show >= segFrom(tl, k)) j = k;
  return o[j] + show;
}

/** The break list with lock-corrected positions: start is exact when the segment before it is locked, the end is exact when the
 *  segment after it is locked too. This is what makes the ad prompt's edges exact. */
export function applyLocks(est: readonly PodEstimate[], locks: Locks, clean: number): PodEstimate[] {
  if (!locks.size || !est.length) return [...est];
  const tl = buildTimeline(est, clean); const o = offsetsOf(tl, locks);
  const sorted = [...est].sort((a, b) => a.cleanAt - b.cleanAt);
  return sorted.map((e, j) => {
    const start = e.cleanAt + o[j]; const end = e.cleanAt + o[j + 1];
    const startExact = locks.has(j); const endExact = locks.has(j + 1);
    return { ...e, startServed: start, endServed: Math.max(start, end), length: Math.max(0, end - start), exact: startExact && endExact, startExact };
  });
}

/* ---------- cues ---------- */
/** Index of the cue being spoken at `show`, or the last one before it (captions stay on the previous line across a pause). -1 before the first. */
export function cueIndexAt(cues: readonly Cue[], show: number): number {
  let lo = 0; let hi = cues.length - 1; let ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (cues[mid].s <= show) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}

/* ---------- silences heard in the audio ---------- */
export const SILENCE_DB = -40;       // below this level a reading is quiet
export const SILENCE_MIN_SECONDS = 0.6;  // tuned on real audio: shorter silences are breaths and hold no information
export const SILENCE_KEEP_SECONDS = 480;
export interface Silence { mid: number; len: number }
/** Turns level readings (dBFS, with the FILE time they were taken at) into silences. A jump in file time (a seek) starts over. */
export class SilenceTracker {
  private runStart: number | null = null; private last = NaN;
  readonly list: Silence[] = [];
  /** File time of the first reading since the last reset: the start of the stretch that has actually been heard. */
  since: number | null = null;
  reset(): void { this.runStart = null; this.last = NaN; this.list.length = 0; this.since = null; }
  feed(db: number, fileTime: number): void {
    if (Number.isFinite(this.last) && (fileTime < this.last - 0.05 || fileTime - this.last > 1.5)) this.reset(); // seek or a stall: old readings no longer line up
    this.last = fileTime;
    if (this.since === null) this.since = fileTime;
    if (db < SILENCE_DB) { if (this.runStart === null) this.runStart = fileTime; return; }
    if (this.runStart !== null) {
      const len = fileTime - this.runStart;
      if (len >= SILENCE_MIN_SECONDS && len < 4) this.list.push({ mid: this.runStart + len / 2, len }); // a long gap is a dropout or an ad bumper, not a speech pause
      this.runStart = null;
    }
    const cutoff = fileTime - SILENCE_KEEP_SECONDS;
    while (this.list.length && this.list[0].mid < cutoff) this.list.shift();
  }
}

/* ---------- Part 2: match transcript pauses to heard silences ---------- */
export interface LockResult { offset: number; matched: number; total: number; second: number }
export const LOCK_MIN_MATCHED = 6;
export const LOCK_MIN_RATIO = 0.5;   // share of the segment's transcript pauses (inside what was heard) that line up with a real silence
export const LOCK_MARGIN = 0.7;      // the runner-up offset must score at most this fraction of the best
export const LOCK_MIN_HEARD_SECONDS = 150;
export const LOCK_TOLERANCE = 0.4;
const STEP = 0.1; const RIVAL_SEPARATION = 1.5;

function hasNear(sorted: readonly number[], x: number, tol: number): boolean {
  let lo = 0; let hi = sorted.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < x) lo = mid + 1; else hi = mid; }
  for (const k of [lo - 1, lo]) if (k >= 0 && k < sorted.length && Math.abs(sorted[k] - x) <= tol) return true;
  return false;
}
/** Find the offset (file - show) that lines the segment's transcript pauses up with the silences heard in `heard` (file time).
 *  Only pauses that fall inside the segment's show range count, so the neighbouring ads and the next segment cannot disturb the
 *  score. Returns null unless one offset clearly beats every other: enough matches, a good share, a runner-up well behind.
 *  Measured on 5 real Kuhner episodes: it locks on roughly a third of the 4-minute windows and was never wrong. Silence is the answer, not a guess. */
export function lockOn(silences: readonly number[], pauses: readonly number[], center: number, span: number, heard: { from: number; to: number }, segment: { from: number; to: number }): LockResult | null {
  if (heard.to - heard.from < LOCK_MIN_HEARD_SECONDS) return null;
  const segPauses = pauses.filter((q) => q >= segment.from + 2 && q <= segment.to - 2);
  if (silences.length < LOCK_MIN_MATCHED || segPauses.length < LOCK_MIN_MATCHED) return null;
  const scores: Array<{ off: number; n: number; t: number }> = [];
  for (let off = center - span; off <= center + span + 1e-9; off += STEP) {
    let n = 0; let t = 0;
    for (const q of segPauses) { const f = q + off; if (f < heard.from || f > heard.to) continue; t++; if (hasNear(silences, f, LOCK_TOLERANCE)) n++; }
    scores.push({ off, n, t });
  }
  let best = scores[0];
  for (const x of scores) if (x.n > best.n) best = x;
  const tied = scores.filter((x) => x.n === best.n && Math.abs(x.off - best.off) <= 0.6);
  const offset = tied.reduce((acc, x) => acc + x.off, 0) / tied.length;
  let second = 0;
  for (const x of scores) if (Math.abs(x.off - best.off) > RIVAL_SEPARATION && x.n > second) second = x.n;
  if (best.n < LOCK_MIN_MATCHED || best.t === 0 || best.n / best.t < LOCK_MIN_RATIO || second > best.n * LOCK_MARGIN) return null;
  return { offset: Math.round(offset * 10) / 10, matched: best.n, total: best.t, second };
}

/* ---------- clustered sponsor reads (prompt only) ---------- */
export interface SponsorWindow { s: number; e: number; score: number }
const STRONG = [/\bbrought to you by\b/i, /\bsponsored by\b/i, /\bpromo(?:tional)? code\b/i, /\buse (?:the )?code\b/i, /\bfree trial\b/i, /\b\d{1,3}\s?(?:%|percent) off\b/i, /\.com\/[a-z0-9]+/i, /\bterms and conditions\b/i, /\bmoney[- ]back guarantee\b/i];
const WEAK = [/\bgo to [a-z0-9-]+(?:\.com| dot com)\b/i, /\bvisit [a-z0-9-]+(?:\.com| dot com)\b/i, /\bour sponsor\b/i, /\bcheck (?:them )?out at\b/i, /\bfree shipping\b/i, /\bsubscribe and save\b/i, /\bfirst (?:order|month|box)\b/i];
export const SPONSOR_WINDOW_SECONDS = 90;
export const SPONSOR_MIN_SCORE = 5;
/** Several clues close together = a sponsor read. One stray "visit foo.com" never counts. Windows are merged and padded to the nearest cues. */
export function sponsorWindows(cues: readonly Cue[]): SponsorWindow[] {
  const hits: Array<{ at: number; end: number; w: number }> = [];
  for (const c of cues) {
    let w = 0;
    for (const r of STRONG) if (r.test(c.t)) w += 2;
    for (const r of WEAK) if (r.test(c.t)) w += 1;
    if (w) hits.push({ at: c.s, end: c.e, w });
  }
  const out: SponsorWindow[] = [];
  let i = 0;
  while (i < hits.length) {
    let j = i; let score = 0;
    while (j < hits.length && hits[j].at - hits[i].at <= SPONSOR_WINDOW_SECONDS) { score += hits[j].w; j++; }
    if (score >= SPONSOR_MIN_SCORE) {
      const s = Math.max(0, hits[i].at - 8); const e = hits[j - 1].end + 6;
      const prev = out[out.length - 1];
      if (prev && s <= prev.e + 10) { prev.e = Math.max(prev.e, e); prev.score += score; } else out.push({ s, e, score });
      i = j;
    } else i++;
  }
  return out;
}

/* ---------- the status line ---------- */
export type SyncState = 'loading' | 'no-transcript' | 'no-map' | 'in-sync' | 'locked' | 'manual' | 'approx' | 'error' | 'not-listed' | 'unmapped';
export function syncLabel(s: SyncState, meter: boolean): string {
  switch (s) {
    case 'loading': return 'Loading transcript…';
    case 'not-listed': return 'The server has not listed this episode yet: retrying…';
    case 'no-transcript': return 'No transcript for this episode';
    case 'unmapped': return 'Ad positions unknown: tap the line you hear to re-align';
    case 'no-map': return 'Captions need the ad map, and this episode has none';
    case 'in-sync': return 'In sync (no ads in this file)';
    case 'locked': return 'Locked to the audio';
    case 'manual': return 'Aligned by you';
    case 'approx': return meter ? 'Approximate: listening for a lock…' : 'Approximate. Tap the line you hear to align';
    default: return 'Transcript unavailable right now';
  }
}
