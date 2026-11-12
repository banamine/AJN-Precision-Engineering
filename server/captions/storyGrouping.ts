// Groups the channels' current excerpts that appear to cover the same topic. Pure, deterministic, no I/O.
// Method: tokens = unigrams + adjacent bigrams (generic English stop words removed). Each token is weighted by IDF
// over the REAL caption pool (so common broadcast words count for little). Two excerpts are linked only if they share
// at least MIN_SHARED distinctive tokens AND their weighted overlap reaches MIN_SCORE. Groups are cliques (every pair
// linked), so one bridging excerpt cannot chain unrelated stories together. The shared terms must also include hard-news
// vocabulary (MIN_NEWS_TERMS): without it, the same commercial airing on two channels scored as a "story" in live data.
// HEURISTIC: thresholds were set from ONE session (3 programs, 138 aligned windows), not a labelled set. A match means similar vocabulary,
// i.e. a coverage indicator. It is NOT verification that the channels say the same thing.

import { newsTermCount } from './excerptScore.js';

export interface GroupInput { id: string; text: string }
export interface PairScore { a: string; b: string; score: number; shared: string[] }
export interface StoryGroup { members: string[]; sharedTerms: string[] }
export interface GroupingResult { groups: StoryGroup[]; pairs: PairScore[] }

export const MIN_SHARED = 3;       // distinctive shared tokens required
export const MIN_SCORE = 0.05;     // weighted overlap (shared idf mass / smaller excerpt's idf mass)
export const MIN_NEWS_TERMS = 2;   // shared tokens that contain hard-news vocabulary
export const DISTINCTIVE_DF = 0.1; // a token is distinctive if it appears in <= 10% of pool minutes

const STOP = new Set(('a about above after again against all also am an and any are aren\'t as at be because been before being below between both but by can cannot could did do does doing down during each few for from further get got had has have having he her here hers herself him himself his how i if in into is it its itself just let like me more most my myself no nor not now of off on once only or other our ours ourselves out over own really same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves ' +
  'don\'t doesn\'t didn\'t isn\'t wasn\'t that\'s it\'s i\'m you\'re we\'re they\'re i\'ve we\'ve i\'ll we\'ll yeah yes okay right know think going go got say said says saying thing things people one two want well back come look see make way even much many still every never always').split(/\s+/));

export function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9'\s-]/g, ' ').split(/\s+/).map((w) => w.replace(/^['-]+|['-]+$/g, '')).filter(Boolean);
}

/** Unigrams (len>=3, not stop) plus bigrams of adjacent non-stop words. */
export function topicalTokens(text: string): Set<string> {
  const words = tokenize(text);
  const out = new Set<string>();
  for (let i = 0; i < words.length; i++) {
    const w = words[i]; const ok = w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w);
    if (!ok) continue;
    out.add(w);
    const n = words[i + 1];
    if (n && n.length >= 3 && !STOP.has(n) && !/^\d+$/.test(n)) out.add(`${w} ${n}`);
  }
  return out;
}

export function groupStories(inputs: GroupInput[], corpus: string[]): GroupingResult {
  const sets = inputs.map((i) => topicalTokens(i.text));
  const wanted = new Set<string>(); for (const s of sets) for (const t of s) wanted.add(t);
  const df = new Map<string, number>();
  for (const doc of corpus) for (const t of topicalTokens(doc)) if (wanted.has(t)) df.set(t, (df.get(t) ?? 0) + 1);
  const N = Math.max(corpus.length, 1);
  const idf = (t: string) => Math.log((N + 1) / ((df.get(t) ?? 0) + 1));
  // Distinctive = rare in the pool. A token seen only in these excerpts (df 0 or 1) is distinctive too.
  const dfLimit = Math.max(1, Math.floor(DISTINCTIVE_DF * N));
  const distinctive = (t: string) => (df.get(t) ?? 0) <= dfLimit;
  const dSets = sets.map((s) => new Set([...s].filter(distinctive)));
  const mass = dSets.map((s) => [...s].reduce((a, t) => a + idf(t), 0));

  const pairs: PairScore[] = []; const linked = new Set<string>();
  for (let i = 0; i < inputs.length; i++) for (let j = i + 1; j < inputs.length; j++) {
    const shared = [...dSets[i]].filter((t) => dSets[j].has(t));
    const sharedMass = shared.reduce((a, t) => a + idf(t), 0);
    const denom = Math.min(mass[i], mass[j]);
    const score = denom > 0 ? sharedMass / denom : 0;
    shared.sort((x, y) => idf(y) - idf(x) || (x < y ? -1 : 1));
    pairs.push({ a: inputs[i].id, b: inputs[j].id, score: Math.round(score * 1000) / 1000, shared: shared.slice(0, 8) });
    if (shared.length >= MIN_SHARED && score >= MIN_SCORE && newsTermCount(shared) >= MIN_NEWS_TERMS) linked.add(`${i}|${j}`);
  }
  // Greedy clique merge, strongest pairs first.
  const order = pairs.map((p, k) => ({ p, k })).filter(({ p }) => linked.has(`${inputs.findIndex((x) => x.id === p.a)}|${inputs.findIndex((x) => x.id === p.b)}`)).sort((x, y) => y.p.score - x.p.score || x.k - y.k);
  const groupOf = inputs.map((_, i) => [i]);
  const find = (i: number) => groupOf.find((g) => g.includes(i))!;
  for (const { p } of order) {
    const i = inputs.findIndex((x) => x.id === p.a), j = inputs.findIndex((x) => x.id === p.b);
    const gi = find(i), gj = find(j);
    if (gi === gj) continue;
    const allLinked = gi.every((x) => gj.every((y) => linked.has(`${Math.min(x, y)}|${Math.max(x, y)}`)));
    if (allLinked) { gi.push(...gj); groupOf.splice(groupOf.indexOf(gj), 1); }
  }
  const groups: StoryGroup[] = groupOf.filter((g) => g.length > 1).map((g) => {
    const members = g.slice().sort((a, b) => a - b);
    const common = [...dSets[members[0]]].filter((t) => members.every((m) => dSets[m].has(t))).sort((x, y) => newsTermCount([x]) === newsTermCount([y]) ? idf(y) - idf(x) || (x < y ? -1 : 1) : newsTermCount([y]) - newsTermCount([x]));
    return { members: members.map((m) => inputs[m].id), sharedTerms: common.slice(0, 5) };
  });
  return { groups, pairs };
}

