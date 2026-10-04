// Pure: turns normalized AJN feed items into the two Radio lists (AJN Radio / AJN Exclusive) with optional paired video.
import { classifyAjnMedia, channelFor, fileKeyOf, type AjnChannel, type AjnClassified } from './ajnClassify.ts';
import { pairAjnMedia, type AjnMatchReason } from './ajnPairing.ts';

export interface RadioFeedItem { id: string; title: string; url: string; mediaType: 'audio' | 'video'; publishedAt?: string | null }
export interface RadioEntry {
  id: string;
  title: string;
  audioUrl: string;
  videoUrl: string | null;
  matchReason: AjnMatchReason;
  channel: AjnChannel;
  airDate: string | null;
  hourNumber: number | null;
  needsReview: boolean;
  classified: AjnClassified;
}
export interface RadioCatalog { radio: RadioEntry[]; exclusive: RadioEntry[] }

function newestFirst(a: RadioEntry, b: RadioEntry): number {
  // Undated entries sink to the bottom; they are never given a guessed date.
  if (a.airDate !== b.airDate) return a.airDate === null ? 1 : b.airDate === null ? -1 : a.airDate < b.airDate ? 1 : -1;
  const hour = (b.hourNumber ?? 0) - (a.hourNumber ?? 0);
  return hour !== 0 ? hour : a.title.localeCompare(b.title);
}

export function buildRadioCatalog(items: readonly RadioFeedItem[]): RadioCatalog {
  const audio: RadioFeedItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (item.mediaType !== 'audio') continue;
    const key = fileKeyOf(item.url) ?? item.url;
    if (seen.has(key)) continue; // same file listed by two feeds is one episode
    seen.add(key);
    audio.push(item);
  }
  const video = items.filter(item => item.mediaType === 'video');
  const entries = pairAjnMedia(audio, video).map<RadioEntry>(({ audio: a, video: v, matchReason }) => {
    const c = classifyAjnMedia({ url: a.url, title: a.title });
    return {
      id: a.id, title: c.airDate ? c.cleanTitle : a.title, audioUrl: a.url, videoUrl: v?.url ?? null, matchReason,
      channel: channelFor(c), airDate: c.airDate, hourNumber: c.hourNumber, needsReview: c.needsReview, classified: c,
    };
  }).sort(newestFirst);
  return { radio: entries.filter(e => e.channel === 'ajn-radio'), exclusive: entries.filter(e => e.channel === 'ajn-exclusive') };
}
