/* One news pool for On Air from the digest, the 13 extra feeds and Citizen Free Press. The same article is shown once (same address, or the same
 * headline), the richer copy (picture + blurb) wins, and age limits are applied here: the ticker stays at 12 h, the news slide uses 48 h. */
import type { Headline } from './useOnAirData';

const TRACKING = /^(utm_|fbclid$|gclid$|mc_|ref$|ref_src$|cmpid$|ncid$|taid$|s$)/i;
/** Same normalisation the server uses: lower-case host without www, no fragment, no tracking parameters, no trailing slash. Null when not http(s). */
export function canonicalUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    u.hash = ''; u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.searchParams.sort();
    const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : '';
    return `${u.protocol}//${u.host}${path}${u.search}`;
  } catch { return null; }
}
const richness = (h: Headline): number => (h.image ? 1 : 0) + (h.blurb ? 1 : 0);
/** Deduplicate (address first, then lower-case headline), richest copy first, then newest. Order of the result: newest first. */
export function dedupeNews(all: readonly Headline[]): Headline[] {
  const seenUrl = new Set<string>(); const seenTitle = new Set<string>(); const out: Headline[] = [];
  for (const h of [...all].sort((a, b) => richness(b) - richness(a) || b.publishedMs - a.publishedMs)) {
    const c = canonicalUrl(h.url); const t = h.text.trim().toLowerCase();
    if ((c && seenUrl.has(c)) || seenTitle.has(t)) continue;
    if (c) seenUrl.add(c); seenTitle.add(t); out.push(h);
  }
  return out.sort((a, b) => b.publishedMs - a.publishedMs);
}
/** Items from the last `maxAgeHours` only (never future-dated). */
export function withinHours(list: readonly Headline[], nowMs: number, maxAgeHours: number): Headline[] {
  const max = maxAgeHours * 3600_000; return list.filter((h) => { const age = nowMs - h.publishedMs; return age >= 0 && age <= max; });
}
export const SLIDE_MAX_AGE_HOURS = 48;
/** Ticker: short window, and no X / Rumble / YouTube posts (those are for the news slide only). Slide: 48 h, everything. */
export function splitNews(all: readonly Headline[], nowMs: number, tickerHours: number): { ticker: Headline[]; slide: Headline[] } {
  const merged = dedupeNews(all);
  return { slide: withinHours(merged, nowMs, SLIDE_MAX_AGE_HOURS), ticker: withinHours(merged.filter((h) => !h.platform), nowMs, tickerHours) };
}
