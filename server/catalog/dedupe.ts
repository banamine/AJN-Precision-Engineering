/* Deduplication. Same Archive identifier is merged earlier (sources are unioned). Here:
 * - exact duplicates = different identifiers whose selected file has the same md5 -> merged into one record (others listed in alsoIdentifiers);
 * - likely duplicates = same normalized title + year/creator -> NEVER merged, only flagged for review with the evidence. */
import { mergeSources, type CatalogRecord } from './record';

export interface ReviewGroup { key: string; ids: string[]; evidence: { normalizedTitle: string; year?: number; creator?: string } }
const PRIORITY: Record<string, number> = { upload: 0, favorite: 1, collection: 2 };
const rank = (r: CatalogRecord) => Math.min(...r.sources.map((s) => PRIORITY[s.kind] ?? 9));
export const normTitle = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export function dedupeRecords(input: CatalogRecord[]): { records: CatalogRecord[]; exactMerged: Array<{ kept: string; merged: string[]; md5: string }>; reviews: ReviewGroup[] } {
  const byMd5 = new Map<string, CatalogRecord[]>();
  const rest: CatalogRecord[] = [];
  for (const r of input) {
    const md5 = r.selected?.md5;
    if (md5) { const g = byMd5.get(md5) ?? []; g.push(r); byMd5.set(md5, g); } else rest.push(r);
  }
  const exactMerged: Array<{ kept: string; merged: string[]; md5: string }> = [];
  const kept: CatalogRecord[] = [...rest];
  for (const [md5, group] of byMd5) {
    group.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
    const [keep, ...dups] = group;
    if (dups.length) {
      keep.sources = dups.reduce((s, d) => mergeSources(s, d.sources), keep.sources);
      keep.alsoIdentifiers = dups.map((d) => d.id);
      exactMerged.push({ kept: keep.id, merged: keep.alsoIdentifiers, md5 });
    }
    kept.push(keep);
  }
  kept.sort((a, b) => a.id.localeCompare(b.id));

  const groups = new Map<string, CatalogRecord[]>();
  for (const r of kept) {
    if (r.status === 'collection') continue;
    const t = normTitle(r.displayTitle);
    if (t.length < 6 || (!r.year && !r.creator)) continue;               // too generic to compare
    const key = `${t}|${r.year ?? ''}|${normTitle(r.creator ?? '')}`;
    const g = groups.get(key) ?? []; g.push(r); groups.set(key, g);
  }
  const reviews: ReviewGroup[] = [];
  for (const [key, g] of groups) {
    if (g.length < 2) continue;
    const [t, y, c] = key.split('|');
    reviews.push({ key, ids: g.map((r) => r.id), evidence: { normalizedTitle: t, year: y ? Number(y) : undefined, creator: c || undefined } });
    for (const r of g) r.reviewFlags = [...(r.reviewFlags ?? []), `likely-duplicate-of:${g.filter((x) => x !== r).map((x) => x.id).join(',')}`];
  }
  return { records: kept, exactMerged, reviews };
}
