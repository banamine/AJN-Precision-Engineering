// Picks the most news-like pair of consecutive caption minutes from one program. Pure, deterministic, no I/O.
// HEURISTIC: generic hard-news vocabulary vs. ad / banter / music markers. It is not entity recognition and it has
// not been validated against a labelled set; `lowSignal` is set when nothing in the program looks like news,
// so the UI can say so instead of presenting a weak pick as a good one. Source wording is never altered.

export interface ScoreMinute { clock: string; startSec: number; text: string }
export interface ExcerptPick { minutes: ScoreMinute[]; score: number; lowSignal: boolean }

export const NEWS = new RegExp('\\b(' + [
  'president', 'prime minister', 'white house', 'senate', 'senator', 'senators', 'congress', 'congressional', 'parliament', 'governor', 'mayor',
  'government', 'administration', 'lawmakers', 'election', 'elections', 'voters', 'vote', 'ballot', 'campaign', 'democrats', 'republicans',
  'court', 'judge', 'supreme court', 'justice department', 'doj', 'fbi', 'police', 'arrested', 'charged', 'indicted', 'investigation', 'investigate',
  'lawsuit', 'ruling', 'verdict', 'trial', 'prosecutors', 'bill', 'legislation', 'shutdown', 'budget', 'tax', 'taxes', 'tariffs',
  'economy', 'economic', 'inflation', 'jobs', 'unemployment', 'market', 'markets', 'stocks', 'interest rates', 'federal reserve',
  'war', 'ceasefire', 'troops', 'military', 'missile', 'attack', 'killed', 'strike', 'sanctions', 'border', 'immigration',
  'israel', 'gaza', 'ukraine', 'russia', 'china', 'iran', 'hurricane', 'wildfire', 'earthquake', 'storm', 'outbreak', 'officials', 'according to',
].map((w) => w.replace(/ /g, '\\s+')).join('|') + ')\\b', 'gi');

const AD = /\b(sponsored by|brought to you by|call now|call 1[- ]?800|limited time|terms apply|restrictions apply|order today|money[- ]back|subscribe|visit [a-z0-9-]+\.com|dot com|stay with us|coming up|after the break|when we come back|welcome back|we'll be right back|closed captioning)\b/gi;
const MUSIC = /\[(music|applause|laughter|singing)[^\]]*\]/gi;

const count = (re: RegExp, s: string) => (s.match(re) ?? []).length;

export function scoreMinute(m: ScoreMinute): number {
  const t = m.text;
  const words = t.trim().split(/\s+/).filter(Boolean).length;
  if (t.trim().length < 40) return -100;
  const hits = t.match(NEWS) ?? [];
  const distinct = new Set(hits.map((h) => h.toLowerCase().replace(/\s+/g, ' '))).size;
  let s = Math.min(distinct, 12) * 10 + Math.min(hits.length, 20) * 2;
  s -= count(AD, t) * 30;
  s -= count(MUSIC, t) * 20;
  s -= Math.min(15, Math.max(0, count(/\?/g, t) - 2) * 3);      // question-heavy = banter / teasers
  s -= Math.min(16, Math.max(0, count(/>>/g, t) - 3) * 4);       // very rapid speaker changes = dialogue
  if (words < 40) s -= 30; else if (words >= 60) s += 10;
  if (m.startSec < 120) s -= 8;                                  // cold opens / intros
  return s;
}

/** Best window of `count` CONSECUTIVE minutes (startSec gaps of 60 s). `minutes` must be sorted by startSec. */
export function pickExcerptWindow(minutes: ScoreMinute[], count = 2): ExcerptPick | null {
  const usable = minutes.length >= count;
  if (!usable) return null;
  const scores = minutes.map(scoreMinute);
  let best = -1; let bestScore = -Infinity;
  for (let i = 0; i + count <= minutes.length; i++) {
    let contiguous = true; let sum = 0;
    for (let k = 0; k < count; k++) {
      if (scores[i + k] <= -100) contiguous = false;
      if (k > 0 && minutes[i + k].startSec - minutes[i + k - 1].startSec !== 60) contiguous = false;
      sum += scores[i + k];
    }
    if (contiguous && sum > bestScore) { bestScore = sum; best = i; }
  }
  if (best < 0) return null;
  return { minutes: minutes.slice(best, best + count), score: bestScore, lowSignal: bestScore < 30 };
}

/** How many of these tokens contain a hard-news vocabulary word (fresh match each call; no regex state shared). */
export function newsTermCount(tokens: string[]): number {
  let n = 0;
  for (const t of tokens) if (t.match(NEWS)) n++;
  return n;
}

