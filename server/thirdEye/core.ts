// Third Eye headline pipeline: pure, deterministic, no I/O.
// Source: archive.org/services/third-eye.php (OCR of the on-screen lower-third text on CNN, FOX, MS NOW, BBC).
// Every threshold below was set from ONE real two-day sample (2026-11-14/15, 5,948 rows), not a labelled set.
// A "story" is a heuristic grouping of similar wording close in time. It is NOT verification that channels agree.
import { tokenize } from '../captions/storyGrouping.js';

export const CHANNEL_NAMES: Record<string, string> = { CNNW: 'CNN', FOXNEWSW: 'FOX', MSNOW: 'MS NOW', BBCNEWS: 'BBC' };
export const MIN_DURATION_SEC = 6;     // 92% of rows pass; 15 would drop real headlines such as "GROUND STOP LIFTED, DELAYS REMAIN" (6 s)
export const MIN_WORDS = 4;
export const MAX_HEADLINE_CHARS = 160;
export const MIN_UPPER_RATIO = 0.85;   // CNN/FOX/MS NOW headlines are ALL-CAPS; mixed-case lines there are ad copy or OCR junk. BBC is exempt.
export const MIN_REPEAT_ROWS = 2;      // a real chyron stays on screen for several minutes; OCR garbage rarely repeats exactly
export const MIN_SINGLE_SECONDS = 40;  // ...unless one row shows it for a long time
export const MERGE_WINDOW_MS = 30 * 60_000;
export const MAX_SINGLE_CHANNEL_PER_HOUR = 3;
export const LINK_MIN_SHARED = 2;
export const LINK_MIN_OVERLAP = 0.5;

/** Short list of commercial phrases that show up as all-caps lower thirds. Heuristic; extend from real misses. */
const AD_PHRASES = ['call for', 'call now', 'free quote', 'free trial', 'free timeshare', 'order now', 'limited time', 'sign up today', 'save up to', '% off', 'visit ', '.com', '1-800', 'ask your doctor'];

export interface ThirdEyeRow { tsMs: number; channel: string; durationSec: number; identifier: string; startSec: number; raw: string }
export interface Variant { channel: string; tsMs: number; text: string; identifier: string; startSec: number; program: string; rows: number; onScreenSec: number }
export interface Story {
  id: string; tsMs: number; channels: string[]; text: string; program: string; identifier: string; startSec: number; onScreenSec: number;
  variants: Variant[];
}

/** Parses the TSV. Returns null when the body is not a Third Eye table (for example an HTML "bad arg" page). */
export function parseThirdEyeTsv(tsv: string): ThirdEyeRow[] | null {
  const lines = tsv.split('\n');
  if (!lines.length || !lines[0].startsWith('date_time')) return null;
  const rows: ThirdEyeRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].replace(/\r$/, '').split('\t');
    if (c.length < 5) continue;
    const tsMs = Date.parse(`${c[0].replace(' ', 'T')}Z`);
    const durationSec = Number.parseInt(c[2], 10);
    const cut = c[3].lastIndexOf('/start/');
    const startSec = cut >= 0 ? Number.parseInt(c[3].slice(cut + 7), 10) : NaN;
    if (!Number.isFinite(tsMs) || !Number.isFinite(durationSec) || !Number.isFinite(startSec) || !CHANNEL_NAMES[c[1]]) continue;
    rows.push({ tsMs, channel: CHANNEL_NAMES[c[1]], durationSec, identifier: c[3].slice(0, cut), startSec, raw: c.slice(4).join('\t') });
  }
  return rows;
}

export const normalizeKey = (s: string): string => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

function upperRatio(s: string): number {
  let letters = 0; let upper = 0;
  for (const ch of s) { if (ch.toLowerCase() !== ch.toUpperCase()) { letters++; if (ch === ch.toUpperCase()) upper++; } }
  return letters ? upper / letters : 0;
}

/** One OCR cell holds several lines separated by the two characters backslash + n (not a real newline). */
export function cleanLines(raw: string, channel: string): string[] {
  const out: string[] = [];
  for (const part of raw.split('\\n')) {
    let s = part.split('\\"').join('"');
    const cut = s.indexOf('. . ');           // OCR region separator: everything after it is a name tag, clock or logo
    if (cut >= 0) s = s.slice(0, cut);
    if (s.endsWith(' . .')) s = s.slice(0, -4);
    s = s.replace(/\s+/g, ' ').trim();
    while (s.length && !/[A-Za-z0-9"]/.test(s[0])) s = s.slice(1);
    if (s.split(' ').length < MIN_WORDS || s.length > MAX_HEADLINE_CHARS) continue;
    if (/[|>[\]{}\\]/.test(s)) continue;
    if ([...s].some((ch) => ch.charCodeAt(0) > 127 && !'’‘“”–—'.includes(ch))) continue;
    if (channel !== 'BBC' && upperRatio(s) < MIN_UPPER_RATIO) continue;
    if (channel === 'BBC' && s.endsWith(' NEWS')) continue; // BBC logo OCR tail ("B EAME NEWS", "OB HE NEWS"), never a real headline ending
    const lower = s.toLowerCase();
    if (AD_PHRASES.some((p) => lower.includes(p))) continue;
    out.push(s);
  }
  return out;
}

const stem = (w: string): string => (w.length > 4 && w.endsWith('ed') ? w.slice(0, -2) : w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w);
const STOPISH = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'was', 'will', 'new', 'after', 'over', 'amid', 'about', 'into', 'its', 'has', 'have', 'not', 'all', 'but', 'out', 'who', 'why', 'how']);
function words(text: string): Set<string> {
  const set = new Set<string>();
  for (const w of tokenize(text)) if (w.length >= 3 && !/^\d+$/.test(w) && !STOPISH.has(w)) set.add(stem(w));
  return set;
}
function similar(a: Set<string>, b: Set<string>): boolean {
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared >= LINK_MIN_SHARED && shared / Math.min(a.size, b.size) >= LINK_MIN_OVERLAP;
}
const programOf = (id: string): string => id.replace(/^[A-Z0-9]+_\d{8}_\d{6}_/, '').replace(/_/g, ' ');
function hash(s: string): string { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); }

/** Rows -> one Variant per (channel, wording) cluster. A cluster ends when the same wording is absent for MERGE_WINDOW_MS. */
export function buildVariants(rows: ThirdEyeRow[]): Variant[] {
  const byKey = new Map<string, { row: ThirdEyeRow; text: string }[]>();
  for (const row of [...rows].sort((a, b) => a.tsMs - b.tsMs)) {
    if (row.durationSec < MIN_DURATION_SEC) continue;
    for (const text of cleanLines(row.raw, row.channel)) {
      const k = `${row.channel}|${normalizeKey(text)}`;
      (byKey.get(k) ?? byKey.set(k, []).get(k)!).push({ row, text });
    }
  }
  const variants: Variant[] = [];
  for (const occ of byKey.values()) {
    let cur: Variant | null = null; let last = 0;
    for (const { row, text } of occ) {
      if (!cur || row.tsMs - last > MERGE_WINDOW_MS) {
        cur = { channel: row.channel, tsMs: row.tsMs, text, identifier: row.identifier, startSec: row.startSec, program: programOf(row.identifier), rows: 0, onScreenSec: 0 };
        variants.push(cur);
      }
      cur.rows++; cur.onScreenSec += row.durationSec; last = row.tsMs;
    }
  }
  return variants.sort((a, b) => a.tsMs - b.tsMs);
}

const passesRepeatGate = (v: Variant): boolean => v.rows >= MIN_REPEAT_ROWS || v.onScreenSec >= MIN_SINGLE_SECONDS;
const better = (a: Variant, b: Variant): boolean => a.rows !== b.rows ? a.rows > b.rows : a.onScreenSec !== b.onScreenSec ? a.onScreenSec > b.onScreenSec : a.text.length > b.text.length;

/** Variants -> stories (similar wording within MERGE_WINDOW_MS), then quality gate and per-channel hourly throttle. Newest first. */
export function buildStories(rows: ThirdEyeRow[]): Story[] {
  const sets = new Map<Variant, Set<string>>();
  const open: { variants: Variant[]; last: number }[] = [];
  const all: { variants: Variant[] }[] = [];
  for (const v of buildVariants(rows)) {
    const vs = words(v.text); sets.set(v, vs);
    if (!vs.size) continue;
    let home = null as (typeof open)[number] | null;
    for (let i = open.length - 1; i >= 0; i--) {
      if (v.tsMs - open[i].last > MERGE_WINDOW_MS) { open.splice(i, 1); continue; }
      if (!home && open[i].variants.some((u) => similar(vs, sets.get(u)!))) home = open[i];
    }
    if (home) { home.variants.push(v); home.last = v.tsMs; } else { const s = { variants: [v], last: v.tsMs }; open.push(s); all.push(s); }
  }
  const stories: Story[] = [];
  for (const s of all) {
    const channels = [...new Set(s.variants.map((v) => v.channel))];
    if (channels.length < 2 && !s.variants.some(passesRepeatGate)) continue;
    const perChannel = new Map<string, Variant>();
    for (const v of s.variants) { const cur = perChannel.get(v.channel); if (!cur || better(v, cur)) perChannel.set(v.channel, v); }
    const variants = [...perChannel.values()].sort((a, b) => a.tsMs - b.tsMs);
    const best = variants.reduce((a, b) => (better(b, a) ? b : a));
    const tsMs = Math.min(...s.variants.map((v) => v.tsMs));
    stories.push({ id: `t${tsMs.toString(36)}-${hash(normalizeKey(best.text))}`, tsMs, channels: variants.map((v) => v.channel), text: best.text, program: best.program, identifier: best.identifier, startSec: best.startSec, onScreenSec: s.variants.reduce((n, v) => n + v.onScreenSec, 0), variants });
  }
  // Throttle single-channel stories only; cross-channel stories are the point of the board and always stay.
  const perSlot = new Map<string, number>();
  const kept: Story[] = [];
  for (const st of [...stories].sort((a, b) => b.onScreenSec - a.onScreenSec)) {
    if (st.channels.length < 2) {
      const slot = `${st.channels[0]}|${Math.floor(st.tsMs / 3_600_000)}`;
      const n = perSlot.get(slot) ?? 0;
      if (n >= MAX_SINGLE_CHANNEL_PER_HOUR) continue;
      perSlot.set(slot, n + 1);
    }
    kept.push(st);
  }
  return kept.sort((a, b) => b.tsMs - a.tsMs);
}
