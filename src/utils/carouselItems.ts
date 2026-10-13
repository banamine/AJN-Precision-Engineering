import type { HomeNowItem } from '../../server/homeNow';
import type { AjnFeedItem } from '../services/ajnFeeds';
import type { MediaType } from '../types';
import { dailyOrder } from './dayRotation';
import { labelAjnItem } from './ajnLabels';

export interface CarouselCard {
  id: string;
  kind: 'now' | 'ajn';
  title: string;
  source: string;
  meta: string;
  mediaType: MediaType;
  thumb?: string;
  artLabel: string;
  path: string;
  subtitle: string;
  channelId?: string;
  guideId?: string;
  programId?: string;
}

const FEED_NAMES: Record<string, string> = {
  AJNHourlyVideo: 'AJN Hourly Video', AJNHourlyAudio: 'AJN Hourly Audio', Alex: 'Alex Jones Show', WarRoom: 'War Room', SundayLive: 'Sunday Night Live',
};
const newest = (a: AjnFeedItem, b: AjnFeedItem) => (Date.parse(b.publishedAt || '') || 0) - (Date.parse(a.publishedAt || '') || 0);

export function nowCards(items: HomeNowItem[], dateKey: string, fmtTime: (iso: string) => string): CarouselCard[] {
  return dailyOrder(items, (i) => i.guideId, dateKey, 'carousel').map((i) => ({
    id: `now:${i.guideId}:${i.programId}`, kind: 'now' as const, title: i.title, source: `${i.guideName} · ${i.channelName}`,
    meta: `On now · until ${fmtTime(i.endTimeUtc)}`, mediaType: i.mediaType, thumb: i.thumb, artLabel: i.channelName,
    path: i.archivePath, subtitle: i.channelName,
  }));
}

/** Newest AJN shows: hourly video (up to 3) plus the newest full-show audio (up to 2). Labels come from the file name, never guessed. */
export function ajnCards(items: AjnFeedItem[]): CarouselCard[] {
  const pick = (feedIds: string[], mt: MediaType, n: number) =>
    items.filter((i) => feedIds.includes(i.feedId) && i.mediaType === mt && i.url).sort(newest).slice(0, n);
  const chosen = [...pick(['AJNHourlyVideo'], 'video', 3), ...pick(['Alex', 'WarRoom'], 'audio', 2)];
  return chosen.map((i) => {
    const label = labelAjnItem(i);
    return {
      id: `ajn:${i.feedId}:${i.id}`, kind: 'ajn' as const,
      title: label ? `${label.show} · ${label.detail}` : i.title,
      source: FEED_NAMES[i.feedId] ?? i.feedId,
      meta: label ? label.dateLabel : '',
      mediaType: i.mediaType, thumb: i.thumbnailUrl, artLabel: label?.show ?? i.title,
      path: i.url!, subtitle: i.feedId, programId: i.id, guideId: `ajn-${i.feedId}`,
    };
  });
}

/** Interleave: two genre cards, then one AJN card, repeating; leftovers appended. */
export function mixCards(now: CarouselCard[], ajn: CarouselCard[]): CarouselCard[] {
  const out: CarouselCard[] = [];
  let a = 0;
  now.forEach((c, i) => { out.push(c); if (i % 2 === 1 && a < ajn.length) out.push(ajn[a++]); });
  while (a < ajn.length) out.push(ajn[a++]);
  return out;
}
