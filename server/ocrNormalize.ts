/* Old-print OCR cleaner for the Declassified Desk. It FINDS and CLEANS sentences that exist on the page. It never writes new text.
 * Tier 1: fixed typography map (long s, ligatures, curly quotes) and joining words split by a hyphen at a line break.
 * Tier 2: one-letter repairs, only when the repaired word is already common in the SAME document (no outside word list, nothing invented),
 *         and every changed word is recorded so the card can say "OCR-corrected". */
import { isProseSentence } from './desk';

export const NORMALIZER_VERSION = 1;
const LIGATURES: Record<string, string> = { 'ſ': 's', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬀ': 'ff', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st', '’': "'", '‘': "'", '“': '"', '”': '"' };

export interface Repair { from: string; to: string }
export interface CleanResult { text: string; repairs: Repair[] }

/** Tier 1 only. Deterministic, reversible by reading the original. */
export function tier1(text: string): string {
  let t = text.replace(/[ſﬁﬂﬀﬃﬄﬅﬆ’‘“”]/g, (c) => LIGATURES[c] ?? c);
  t = t.replace(/(\p{L})-[ \t]*\r?\n[ \t]*(\p{Ll})/gu, '$1$2'); // hyphen at a line break
  return t.replace(/[ \t]+/g, ' ');
}

function freq(text: string): Map<string, number> {
  const f = new Map<string, number>();
  for (const m of text.toLowerCase().matchAll(/[a-z]{2,}/g)) f.set(m[0], (f.get(m[0]) ?? 0) + 1);
  return f;
}
/** Old print: the long s is read as f. Only that swap is tried, so "fame" can never become "same" unless "fame" is itself rare and "same" is common. */
function candidates(w: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < w.length; i++) if (w[i] === 'f') out.push(w.slice(0, i) + 's' + w.slice(i + 1));
  if (/f/.test(w)) out.push(w.replace(/f/g, 's'));
  return out;
}
const MIN_GOOD = 20; // the repaired word must already appear this often in the document
const MAX_OWN = 2;   // and the word as printed must be rare there (so real words like "fame" are not touched)

/** Join "what- ever" (hyphen + space inside a line) only when the joined word already appears in the document. */
function joinSplitWords(text: string, f: Map<string, number>): string {
  return text.replace(/([A-Za-z]{2,})- ([a-z]{2,})/g, (m, a, b) => ((f.get((a + b).toLowerCase()) ?? 0) >= 1 ? a + b : m));
}
function repairWith(text: string, f: Map<string, number>): CleanResult {
  const repairs: Repair[] = [];
  const out = text.replace(/[A-Za-z]{3,}/g, (w) => {
    const lw = w.toLowerCase(); const own = f.get(lw) ?? 0;
    if (own > MAX_OWN) return w;
    let best = ''; let bestN = 0;
    for (const c of candidates(lw)) { const n = f.get(c) ?? 0; if (n > bestN) { best = c; bestN = n; } }
    if (!best || bestN < MIN_GOOD) return w;
    const fixed = w[0] === w[0].toUpperCase() ? best[0].toUpperCase() + best.slice(1) : best;
    repairs.push({ from: w, to: fixed });
    return fixed;
  });
  return { text: out, repairs };
}

/** Tier 1, then Tier 2 against the document's own vocabulary. */
export function normalizeOldText(raw: string): CleanResult {
  const base = tier1(raw);
  const f = freq(base);
  return repairWith(joinSplitWords(base, f), f);
}

export interface FoundSentence { text: string; raw: string; corrected: boolean; repairs: Repair[] }
/** Real sentences that pass the Desk's own prose test. Each is the page's own sentence after cleaning; `raw` keeps the Tier-1 text before repairs. */
export function findSentences(raw: string, limit = 20): FoundSentence[] {
  const base = tier1(raw);
  const f = freq(base);
  const body = joinSplitWords(base, f).replace(/\s*\r?\n\s*/g, ' ').replace(/\s+/g, ' ');
  const out: FoundSentence[] = [];
  for (const s of body.split(/(?<=[.!?])\s+(?=[A-Z])/)) {
    const r = repairWith(s.trim(), f); const t = r.text;
    if (t.length < 40 || t.length > 320 || !isProseSentence(t)) continue;
    out.push({ text: t, raw: s.trim(), corrected: r.repairs.length > 0, repairs: r.repairs });
    if (out.length >= limit) break;
  }
  return out;
}
