/* The On This Day panel shows three kinds of entries one at a time: Desk stories (news-article cards), the library's real
 * Archive items, and the library recording. Pure function of the clock: which entry is on screen at nowMs, with a longer
 * dwell for stories because they carry a headline and a lead. */
export const ITEM_DWELL_MS = 9000;
export const STORY_DWELL_MS = 14000;

export type EntryKind = 'story' | 'item' | 'rush';
export interface Entry { kind: EntryKind; index: number }

/** Near-date stories first (they arrive already ranked), then the remaining stories alternate with the existing entries so both kinds appear. */
export function buildEntries(storyCount: number, nearCount: number, itemCount: number, hasRush: boolean): Entry[] {
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
  return out;
}
export const dwellOf = (e: Entry): number => (e.kind === 'story' ? STORY_DWELL_MS : ITEM_DWELL_MS);

export function pickEntry(entries: Entry[], nowMs: number): { entry: Entry; n: number; total: number } | null {
  if (entries.length === 0) return null;
  const cycle = entries.reduce((a, e) => a + dwellOf(e), 0);
  let t = ((nowMs % cycle) + cycle) % cycle;
  for (let n = 0; n < entries.length; n++) { const d = dwellOf(entries[n]); if (t < d) return { entry: entries[n], n: n + 1, total: entries.length }; t -= d; }
  return { entry: entries[0], n: 1, total: entries.length };
}
