/* The On This Day panel shows three kinds of entries one at a time: Desk stories (news-article cards), the library's real
 * Archive items, and the library recording. Pure function of the clock: which entry is on screen at nowMs, with a longer
 * dwell for stories because they carry a headline and a lead. */
export const ITEM_DWELL_MS = 14000;
export const STORY_DWELL_MS = 22000;
export const NEWS_DWELL_MS = 18000;
/** Headlines shown per news slide, and the most slides in one cycle. */
export const NEWS_PER_SLIDE = 3;
export const NEWS_MAX_SLIDES = 3;

export type EntryKind = 'story' | 'item' | 'rush' | 'news';
export interface Entry { kind: EntryKind; index: number }

/** Near-date stories first (they arrive already ranked), then the remaining stories alternate with the existing entries so both kinds appear. */
export function buildEntries(storyCount: number, nearCount: number, itemCount: number, hasRush: boolean, newsSlides = 0): Entry[] {
  const out: Entry[] = [];
  const near = Math.min(nearCount, storyCount);
  for (let i = 0; i < near; i++) out.push({ kind: 'story', index: i });
  const others: Entry[] = [];
  for (let i = 0; i < itemCount; i++) others.push({ kind: 'item', index: i });
  if (hasRush) others.push({ kind: 'rush', index: 0 });
  let s = near, o = 0;
  while (s < storyCount || o < others.length) {
    if (s < storyCount) out.push({ kind: 'story', index: s++ });
    if (o < others.length) { out.push(others[o]); o++; }
  }
  // Current-news slides are spread evenly through the cycle (never bunched), only when there are real headlines.
  if (newsSlides > 0 && out.length > 0) {
    const gap = Math.max(1, Math.floor(out.length / newsSlides));
    const withNews: Entry[] = [];
    let placed = 0;
    out.forEach((e, i) => { withNews.push(e); if (placed < newsSlides && (i + 1) % gap === 0) withNews.push({ kind: 'news', index: placed++ }); });
    while (placed < newsSlides) withNews.push({ kind: 'news', index: placed++ });
    return withNews;
  }
  if (newsSlides > 0) for (let i = 0; i < newsSlides; i++) out.push({ kind: 'news', index: i });
  return out;
}
export const dwellOf = (e: Entry): number => (e.kind === 'story' ? STORY_DWELL_MS : e.kind === 'news' ? NEWS_DWELL_MS : ITEM_DWELL_MS);

export function pickEntry(entries: Entry[], nowMs: number): { entry: Entry; n: number; total: number; elapsedMs: number; round: number } | null {
  if (entries.length === 0) return null;
  const cycle = entries.reduce((a, e) => a + dwellOf(e), 0);
  const round = Math.floor(nowMs / cycle);
  let t = ((nowMs % cycle) + cycle) % cycle;
  for (let n = 0; n < entries.length; n++) { const d = dwellOf(entries[n]); if (t < d) return { entry: entries[n], n: n + 1, total: entries.length, elapsedMs: t, round }; t -= d; }
  return { entry: entries[0], n: 1, total: entries.length, elapsedMs: 0, round };
}

/** Headlines for the news slides: one from each source in turn (sources ordered by their newest item), so one busy feed cannot fill every slide. */
export function diverseHeadlines<T extends { source: string; publishedMs: number }>(list: readonly T[], n: number): T[] {
  const by = new Map<string, T[]>();
  for (const h of [...list].sort((a, b) => b.publishedMs - a.publishedMs)) by.set(h.source, [...(by.get(h.source) ?? []), h]);
  const queues = [...by.values()]; const out: T[] = [];
  for (let round = 0; out.length < n && queues.some((q) => q.length > round); round++) for (const q of queues) { if (q[round] && out.length < n) out.push(q[round]); }
  return out;
}
