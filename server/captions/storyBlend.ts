// Blends the 24 h ledger cards into ranked stories using storyGrouping.ts. Pure, deterministic, no I/O.
// Never merges or alters card wording; the lead card's verbatim excerpt is what gets shown.
// A match means similar vocabulary on cards aired within 6 h of each other. It is NOT verification of the same event.
import { newsTermCount } from './excerptScore.js';
import { groupStories, MIN_NEWS_TERMS, MIN_SCORE, MIN_SHARED } from './storyGrouping.js';
import type { StoryCard } from './storyLedger.js';

export const MAX_BLEND_CARDS = 240; // equals the ledger card cap
export const MAX_STORY_LINK_GAP_MS = 6 * 60 * 60 * 1000;
export const RECENCY_HALF_LIFE_MS = 6 * 60 * 60 * 1000;

export type NeverMergePair = readonly [string, string];
/** Static on purpose (owner decision 2026-11-12: least footprint, no env parsing). Matches network code, network name or program title. */
export const DEFAULT_NEVER_MERGE_PAIRS: readonly NeverMergePair[] = Object.freeze([
  ['Alex Jones', "Real America's Voice"],
  ['Harrison Smith', "Real America's Voice"],
  ['INFOWARS', 'RAV'],
  ['War Room', "Real America's Voice"],
]);

export interface Story {
  storyId: string;
  leadCardId: string;
  cardIds: string[];
  networks: string[];
  sharedTerms: string[];
  firstAirUtc: string;
  lastAirUtc: string;
  coverage: number;
  score: number;
}
export interface BlendOptions { corpus?: readonly string[]; neverMergePairs?: readonly NeverMergePair[] }

const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
function stableHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `st_${(h >>> 0).toString(16).padStart(8, '0')}`;
}
const matchesRule = (c: StoryCard, token: string) => {
  const t = token.toLowerCase();
  return c.networkCode.toLowerCase() === t || c.network.toLowerCase() === t || c.programTitle.toLowerCase().includes(t);
};
const blocked = (a: StoryCard, b: StoryCard, pairs: readonly NeverMergePair[]) =>
  pairs.some(([l, r]) => (matchesRule(a, l) && matchesRule(b, r)) || (matchesRule(a, r) && matchesRule(b, l)));

export function buildStories(cards: readonly StoryCard[], nowMs: number, options: BlendOptions = {}): Story[] {
  if (!Number.isFinite(nowMs)) throw new RangeError('nowMs must be finite');
  if (!cards.length) return [];
  const never = options.neverMergePairs ?? DEFAULT_NEVER_MERGE_PAIRS;
  const air = (c: StoryCard) => Date.parse(c.windowStartUtc);
  const ordered = cards.slice().sort((a, b) => air(b) - air(a) || b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const compared = ordered.slice(0, MAX_BLEND_CARDS);
  const rest = ordered.slice(MAX_BLEND_CARDS);

  const inputs = compared.map((c) => ({ id: c.id, text: c.minutes.map((m) => m.text).join(' ') }));
  // Default corpus = the cards themselves (no extra text kept anywhere). An explicit corpus is used only if non-empty.
  const corpus = options.corpus && options.corpus.length ? [...options.corpus] : inputs.map((i) => i.text);
  const { pairs } = groupStories(inputs, corpus);
  const idx = new Map<string, number>();
  compared.forEach((c, i) => idx.set(c.id, i));

  const linked = new Set<string>();
  const valid: Array<{ i: number; j: number; score: number; shared: string[]; order: number }> = [];
  pairs.forEach((p, k) => {
    const i = idx.get(p.a); const j = idx.get(p.b);
    if (i === undefined || j === undefined) return;
    if (p.shared.length < MIN_SHARED || p.score < MIN_SCORE || newsTermCount(p.shared) < MIN_NEWS_TERMS) return;
    if (Math.abs(air(compared[i]) - air(compared[j])) > MAX_STORY_LINK_GAP_MS) return;
    if (blocked(compared[i], compared[j], never)) return;
    const lo = Math.min(i, j); const hi = Math.max(i, j);
    linked.add(`${lo}|${hi}`);
    valid.push({ i: lo, j: hi, score: p.score, shared: p.shared, order: k });
  });
  valid.sort((a, b) => b.score - a.score || a.order - b.order);

  const groups: number[][] = compared.map((_, i) => [i]);
  const find = (i: number) => groups.find((g) => g.includes(i))!;
  for (const v of valid) {
    const gi = find(v.i); const gj = find(v.j);
    if (gi === gj) continue;
    if (gi.every((x) => gj.every((y) => linked.has(`${Math.min(x, y)}|${Math.max(x, y)}`)))) {
      gi.push(...gj);
      groups.splice(groups.indexOf(gj), 1);
    }
  }
  const sharedByPair = new Map<string, string[]>();
  for (const v of valid) sharedByPair.set(`${v.i}|${v.j}`, v.shared);

  const built: Array<{ cards: StoryCard[]; sharedTerms: string[] }> = groups.map((g) => {
    let sharedTerms: string[] = [];
    if (g.length > 1) {
      const first = sharedByPair.get(`${Math.min(g[0], g[1])}|${Math.max(g[0], g[1])}`) ?? [];
      sharedTerms = first.filter((term) => g.every((a, ai) => g.every((b, bi) => bi <= ai ||
        (sharedByPair.get(`${Math.min(a, b)}|${Math.max(a, b)}`) ?? []).includes(term)))).slice(0, 5);
    }
    return { cards: g.map((i) => compared[i]), sharedTerms };
  });
  for (const c of rest) built.push({ cards: [c], sharedTerms: [] });

  const stories: Story[] = built.map(({ cards: members, sharedTerms }) => {
    const sorted = members.slice().sort((a, b) => b.score - a.score || air(b) - air(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const lead = sorted[0];
    let min = Infinity; let max = -Infinity;
    const networks: string[] = [];
    for (const c of sorted) { const t = air(c); if (t < min) min = t; if (t > max) max = t; if (!networks.includes(c.network)) networks.push(c.network); }
    const decay = Math.pow(0.5, Math.max(0, nowMs - max) / RECENCY_HALF_LIFE_MS);
    const rank = decay * (1 + 0.5 * (networks.length - 1)) * clamp(lead.score / 60, 0.2, 1.5);
    return {
      storyId: stableHash(lead.id), leadCardId: lead.id, cardIds: sorted.map((c) => c.id), networks, sharedTerms,
      firstAirUtc: iso(min), lastAirUtc: iso(max), coverage: networks.length, score: Math.round(rank * 10000) / 10000,
    };
  });
  stories.sort((a, b) => b.score - a.score || Date.parse(b.lastAirUtc) - Date.parse(a.lastAirUtc) || (a.storyId < b.storyId ? -1 : a.storyId > b.storyId ? 1 : 0));
  return stories;
}
