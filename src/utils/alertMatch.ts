/* Listen Alerts: rule shape, text normalisation and the matcher. Pure (no network, no clock, no React) so the server index and the
 * browser tests run the SAME code. Rules live in the browser (alertRules.ts); the server only ever sees them inside one request body.
 *
 * Matching is whole-word / whole-phrase only, never a substring ("ice" does not hit "police"). Case, accents, punctuation and a
 * possessive 's are ignored ("Trump's" matches "trump"). A phrase may span two caption cues. One hit per
 * rule + episode + 120 s bucket, so a name said ten times in one minute is one alert, but the same name 10 minutes later is another. */

export const TERM_TYPES = ['keyword', 'brand', 'person', 'topic', 'competitor'] as const;
export type TermType = (typeof TERM_TYPES)[number];

export interface AlertTerm { type: TermType; text: string; aliases?: string[] }
export type AlertScope = { kind: 'all' } | { kind: 'shows'; showIds: string[] };
export interface AlertRule { id: string; name: string; enabled: boolean; scope: AlertScope; terms: AlertTerm[] }

export const LIMITS = { rules: 20, termsPerRule: 30, aliasesPerTerm: 8, termChars: 80, nameChars: 60, showsPerRule: 100, minPhraseChars: 2 } as const;
export const HIT_BUCKET_SECONDS = 120;
export const MAX_SNIPPET_CHARS = 240;

export interface CueLike { s: number; e: number; t: string; sp?: string }
export interface NormIndex { full: string; starts: number[] }

/** The one text normaliser, used for transcripts and for terms alike. */
export function normalizeText(input: string): string {
  return String(input ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Normalised phrases one term answers to: its text plus aliases, without duplicates or one-letter noise. */
export function phrasesOf(term: AlertTerm): string[] {
  const out: string[] = [];
  for (const raw of [term.text, ...(term.aliases ?? [])]) {
    const p = normalizeText(raw);
    if (p.length >= LIMITS.minPhraseChars && !out.includes(p)) out.push(p);
  }
  return out;
}

export function indexCues(cues: readonly CueLike[]): NormIndex {
  const starts: number[] = []; let full = '';
  for (const cue of cues) {
    const part = normalizeText(cue.t);
    starts.push(full ? full.length + 1 : 0);
    if (part) full = full ? `${full} ${part}` : part;   // an empty cue adds nothing (no double spaces that would break a phrase across it)
  }
  return { full, starts };
}

function cueAt(starts: readonly number[], pos: number): number {
  let lo = 0; let hi = starts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; }
  return lo;
}

export function hashKey(s: string): string { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

export interface EpisodeRef {
  showId: string; showName: string; channelId: string; programId: string; guid: string; title: string; publishedAt: number; url: string;
  /** feed whose newest episode is old: searchable, but its hits are "library matches", never new alerts */
  archive: boolean;
  /** the show's feed artwork (small size), when the feed supplies one */
  logo?: string;
}
export interface AlertHit {
  id: string; ruleId: string; ruleName: string;
  termType: TermType; term: string; matchedTerms: string[];
  showId: string; showName: string; channelId: string; programId: string; guid: string; title: string; publishedAt: number; url: string;
  /** index into the episode's transcript cues (the same cue list the caption player loads) */
  cueIndex: number; cueStart: number; cueEnd: number; speaker?: string; snippet: string;
  archive: boolean;
  logo?: string;
  /** the cue time is the PUBLISHER transcript's clock (the show without its ads). The player calibrates it once the audio is playing. */
  timing: 'clean-show';
}

export function ruleAppliesTo(rule: AlertRule, showId: string): boolean {
  return rule.enabled && (rule.scope.kind === 'all' || rule.scope.showIds.includes(showId));
}

function snippetOf(cues: readonly CueLike[], i: number): string {
  const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
  let text = clean(cues[i].t);
  if (text.length < 80 && i > 0) text = `${clean(cues[i - 1].t)} ${text}`.trim();
  return text.length > MAX_SNIPPET_CHARS ? `${text.slice(0, MAX_SNIPPET_CHARS - 1).trimEnd()}…` : text;
}

export function matchEpisode(rules: readonly AlertRule[], ep: EpisodeRef, cues: readonly CueLike[], idx: NormIndex = indexCues(cues)): AlertHit[] {
  if (!cues.length || !idx.full) return [];
  const padded = ` ${idx.full} `;
  const found = new Map<string, AlertHit>();
  for (const rule of rules) {
    if (!ruleAppliesTo(rule, ep.showId)) continue;
    for (const term of rule.terms) {
      for (const phrase of phrasesOf(term)) {
        const needle = ` ${phrase} `;
        for (let at = padded.indexOf(needle); at !== -1; at = padded.indexOf(needle, at + phrase.length)) {
          const ci = cueAt(idx.starts, at);   // `at` in padded == offset of the phrase in idx.full
          const cue = cues[ci];
          const key = `${rule.id}|${ep.showId}:${ep.guid}|${Math.floor(cue.s / HIT_BUCKET_SECONDS)}`;
          const prev = found.get(key);
          if (prev) {
            if (!prev.matchedTerms.includes(term.text)) prev.matchedTerms.push(term.text);
            if (ci < prev.cueIndex) { prev.cueIndex = ci; prev.cueStart = cue.s; prev.cueEnd = cue.e; prev.speaker = cue.sp; prev.term = term.text; prev.termType = term.type; }
          } else {
            found.set(key, {
              id: hashKey(key), ruleId: rule.id, ruleName: rule.name, termType: term.type, term: term.text, matchedTerms: [term.text],
              showId: ep.showId, showName: ep.showName, channelId: ep.channelId, programId: ep.programId, guid: ep.guid, title: ep.title,
              publishedAt: ep.publishedAt, url: ep.url, cueIndex: ci, cueStart: cue.s, cueEnd: cue.e, ...(cue.sp ? { speaker: cue.sp } : {}),
              snippet: '', archive: ep.archive, ...(ep.logo ? { logo: ep.logo } : {}), timing: 'clean-show',
            });
          }
        }
      }
    }
  }
  const hits = [...found.values()];
  for (const h of hits) h.snippet = snippetOf(cues, h.cueIndex);
  return hits.sort((a, b) => a.cueStart - b.cueStart);
}

/* ---------- rule validation: used on the server for the request body and in the browser for what is in localStorage ---------- */
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

export function sanitizeRules(raw: unknown): AlertRule[] {
  if (!Array.isArray(raw)) return [];
  const out: AlertRule[] = []; const ids = new Set<string>();
  for (const r of raw.slice(0, LIMITS.rules)) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const id = str(o.id, 40); const name = str(o.name, LIMITS.nameChars);
    if (!id || !name || ids.has(id)) continue;
    const terms: AlertTerm[] = [];
    for (const t of Array.isArray(o.terms) ? o.terms.slice(0, LIMITS.termsPerRule) : []) {
      if (!t || typeof t !== 'object') continue;
      const to = t as Record<string, unknown>;
      const text = str(to.text, LIMITS.termChars);
      const type = TERM_TYPES.includes(to.type as TermType) ? (to.type as TermType) : 'keyword';
      if (normalizeText(text).length < LIMITS.minPhraseChars) continue;
      const aliases = (Array.isArray(to.aliases) ? to.aliases : []).map((a) => str(a, LIMITS.termChars)).filter((a) => normalizeText(a).length >= LIMITS.minPhraseChars).slice(0, LIMITS.aliasesPerTerm);
      terms.push({ type, text, ...(aliases.length ? { aliases } : {}) });
    }
    if (!terms.length) continue;
    const sc = o.scope as Record<string, unknown> | undefined;
    const scope: AlertScope = sc && sc.kind === 'shows' && Array.isArray(sc.showIds)
      ? { kind: 'shows', showIds: sc.showIds.map((s) => str(s, 80)).filter(Boolean).slice(0, LIMITS.showsPerRule) }
      : { kind: 'all' };
    if (scope.kind === 'shows' && !scope.showIds.length) continue;
    ids.add(id);
    out.push({ id, name, enabled: o.enabled !== false, scope, terms });
  }
  return out;
}
