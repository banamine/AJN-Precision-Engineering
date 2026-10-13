// Pure: the newest whole-show recording of Alex Jones and of War Room, for the Home shortcut buttons.
// Dates come from the filename only (never guessed); an item with a bad date is ignored. Nothing is hard-coded per day:
// when the feeds publish a new day, the next load picks it up.
import { classifyAjnMedia, formatAirDate, type AjnShowSlug } from './ajnClassify.ts';
import { dayKindLabel, dayKindOf, type DayKind } from './ajnShowGroups.ts';

export interface FeedItemLike { id: string; title?: string; url?: string; mediaType?: string }
export interface LatestFullShow {
  showSlug: AjnShowSlug; showName: string; id: string; url: string; title: string;
  airDate: string; dayKind: DayKind; dateLabel: string; kindLabel: string;
}

export const SHORTCUT_SHOWS: { slug: AjnShowSlug; name: string; feedId: 'Alex' | 'WarRoom' }[] = [
  { slug: 'alex-jones', name: 'Alex Jones', feedId: 'Alex' },
  { slug: 'war-room', name: 'War Room', feedId: 'WarRoom' },
];

/** Newest whole-show audio item per show. A show with no valid item is simply absent (the UI says "unavailable"). */
export function pickLatestFullShows(itemsByFeed: Partial<Record<'Alex' | 'WarRoom', readonly FeedItemLike[]>>): LatestFullShow[] {
  const out: LatestFullShow[] = [];
  for (const show of SHORTCUT_SHOWS) {
    let best: LatestFullShow | null = null;
    for (const item of itemsByFeed[show.feedId] ?? []) {
      if (!item.url || item.mediaType === 'video') continue;
      const c = classifyAjnMedia({ url: item.url, title: item.title });
      // whole shows only: no hour number; accept the Saturday "Special" variant as that day's full show
      if (c.showSlug !== show.slug || !c.airDate || c.needsReview || c.hourNumber !== null || c.kind !== 'audio') continue;
      if (!best || c.airDate > best.airDate) {
        const kind = dayKindOf(c.airDate, (c.variant ?? '').toLowerCase() === 'special');
        best = { showSlug: show.slug, showName: show.name, id: item.id, url: item.url, title: c.cleanTitle, airDate: c.airDate, dayKind: kind, dateLabel: formatAirDate(c.airDate), kindLabel: dayKindLabel(kind) };
      }
    }
    if (best) out.push(best);
  }
  return out;
}
