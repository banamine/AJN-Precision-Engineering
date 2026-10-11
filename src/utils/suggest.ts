/* Auto-fill search helpers (pure — no DOM). Suggestions start at 2 characters; matching is accent- and case-insensitive.
 * Rank: whole-string prefix > a word starts with the query > substring. Ties keep the caller's order (put newest first). */
export const SUGGEST_MIN_CHARS = 2;
export interface SuggestCandidate { text: string; kind?: 'recent' | 'history' | 'favorite' | 'topic' }
export interface Suggestion extends SuggestCandidate { rank: number }
export interface HighlightPart { text: string; match: boolean }

/** Per-character fold with an index map back to the original string, so highlight ranges stay correct. */
function foldMap(s: string): { folded: string; map: number[] } {
  let folded = ''; const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const f = s[i].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    for (let j = 0; j < f.length; j++) { folded += f[j]; map.push(i); }
  }
  return { folded, map };
}
export const foldText = (s: string): string => foldMap(s).folded;
export const normalizeQuery = (q: string): string => foldText(q).replace(/\s+/g, ' ').trim();

export function suggest(query: string, candidates: SuggestCandidate[], limit = 8): Suggestion[] {
  const q = normalizeQuery(query);
  if (q.length < SUGGEST_MIN_CHARS) return [];
  const seen = new Set<string>();
  const out: Array<Suggestion & { order: number }> = [];
  candidates.forEach((c, order) => {
    const t = c.text?.trim(); if (!t) return;
    const f = foldText(t).replace(/\s+/g, ' ');
    if (seen.has(f) || f === q) return; // never offer exactly what is already typed
    let rank = 0;
    if (f.startsWith(q)) rank = 3;
    else if (new RegExp(`(^|[^\\p{L}\\p{N}])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').test(f)) rank = 2;
    else if (f.includes(q)) rank = 1;
    if (!rank) return;
    seen.add(f); out.push({ ...c, text: t, rank, order });
  });
  out.sort((a, b) => b.rank - a.rank || a.order - b.order);
  return out.slice(0, limit).map(({ order, ...s }) => s);
}

/** Splits text into matched / unmatched runs for every query word (2+ chars, or the whole query), for <mark> rendering. */
export function highlightParts(text: string, query: string): HighlightPart[] {
  const q = normalizeQuery(query);
  if (!q || !text) return [{ text, match: false }];
  const { folded, map } = foldMap(text);
  const hit = new Array<boolean>(text.length).fill(false);
  const terms = [q, ...q.split(' ').filter((w) => w.length >= SUGGEST_MIN_CHARS)];
  for (const term of terms) {
    for (let from = folded.indexOf(term); from !== -1; from = folded.indexOf(term, from + 1)) {
      for (let k = from; k < from + term.length; k++) hit[map[k]] = true;
    }
  }
  const parts: HighlightPart[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = parts[parts.length - 1];
    if (last && last.match === hit[i]) last.text += text[i]; else parts.push({ text: text[i], match: hit[i] });
  }
  return parts;
}

/** Combobox keyboard model: returns the next active index (-1 = none) for a key, or null when the key isn't navigation. */
export function nextActiveIndex(key: string, active: number, count: number): number | null {
  if (count <= 0) return null;
  if (key === 'ArrowDown') return active + 1 >= count ? 0 : active + 1;
  if (key === 'ArrowUp') return active <= 0 ? count - 1 : active - 1;
  if (key === 'Home' && active >= 0) return 0;
  if (key === 'End' && active >= 0) return count - 1;
  return null;
}

export const RECENT_SEARCH_KEY = 'ajn.recentSearches.v1';
const RECENT_SEARCH_LIMIT = 20;
export function addRecentSearch(list: string[], q: string): string[] {
  const t = q.trim(); if (t.length < SUGGEST_MIN_CHARS) return list;
  const f = foldText(t);
  return [t, ...list.filter((x) => foldText(x) !== f)].slice(0, RECENT_SEARCH_LIMIT);
}
export function loadRecentSearches(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): string[] {
  try { const v = JSON.parse(storage?.getItem(RECENT_SEARCH_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, RECENT_SEARCH_LIMIT) : []; } catch { return []; }
}
export function saveRecentSearches(list: string[], storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): boolean {
  try { storage?.setItem(RECENT_SEARCH_KEY, JSON.stringify(list)); return true; } catch { return false; }
}

/** Seed topics so the dropdown is useful before there is any history. */
export const DEFAULT_TOPICS = ['Election', 'Economy', 'Congress', 'Space', 'Foreign Policy', 'Briefing', 'Supreme Court', 'Technology', 'Immigration', 'Healthcare', 'Inflation', 'Ukraine', 'Middle East', 'Climate', 'Interview'];
/** Candidate order = priority on ties: your recent searches, your favorites, what you watched, then seed topics. */
export function buildSuggestCandidates(recentSearches: string[], favoriteTitles: string[], historyTitles: string[]): SuggestCandidate[] {
  return [
    ...recentSearches.map((text) => ({ text, kind: 'recent' as const })),
    ...favoriteTitles.map((text) => ({ text, kind: 'favorite' as const })),
    ...historyTitles.map((text) => ({ text, kind: 'history' as const })),
    ...DEFAULT_TOPICS.map((text) => ({ text, kind: 'topic' as const })),
  ];
}
