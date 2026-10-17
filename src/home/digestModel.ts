// Today's Digest (Home): pure logic, no React and no network.
// Order: items that are REALLY new first (AJN feed items published in the last 72 h, newest first, at most 3 per show),
// then a seeded-random backfill from the whole Library, audio and video alternating, at most 3 per category.
// Nothing here is a popularity or "trending" claim: a card is labelled NEW only when its feed date says so.
import { dailyOrder, hash32, localDateKey } from '../utils/dayRotation';
import type { DiscoverItem } from './hubModel';

export const DIGEST_LIMIT = 24;
export const NEW_WINDOW_MS = 72 * 3600_000;
export const NEW_PER_SHOW = 3;
export const LIBRARY_PER_CATEGORY = 3;
const FUTURE_SLACK_MS = 3600_000; // a feed date more than 1 h ahead of the clock is not trusted

export const AJN_DIGEST_FEEDS: ReadonlyArray<{ id: string; name: string }> = [
  { id: 'Alex', name: 'The Alex Jones Show' }, { id: 'WarRoom', name: 'War Room' }, { id: 'SundayLive', name: 'Sunday Night Live' },
  { id: 'AJNHourlyVideo', name: 'Network Hourly · Video' }, { id: 'AJNHourlyAudio', name: 'Network Hourly · Audio' },
];

export interface DigestCard {
  key: string; tier: 'new' | 'library'; showLabel: string; categoryId: string; title: string; subtitle: string;
  mediaType: 'video' | 'audio'; path: string; thumb?: string; durSeconds?: number; publishedMs?: number;
  channelId: string; guideId: string; programId: string; sourceId?: string; assetId?: string;
}
export interface FeedItemWire { id?: string; title?: string; url?: string; mediaType?: string; publishedAt?: string; thumbnailUrl?: string }

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** Plain text from a feed title: tags removed after every decode pass (feeds are often double-encoded). */
export function plainText(value: unknown, max = 200): string {
  if (typeof value !== 'string') return '';
  let text = value.replace(/<[^>]*>/g, ' ');
  for (let pass = 0; pass < 3; pass++) {
    const next = text.replace(/&(#\d+|[a-z]+);/gi, (m, b: string) => (b[0] === '#' ? String.fromCodePoint(Number(b.slice(1)) || 32) : NAMED[b.toLowerCase()] ?? m)).replace(/<[^>]*>/g, ' ');
    if (next === text) break; text = next;
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}
const httpsUrl = (v: unknown): string | null => { try { const u = new URL(String(v)); return u.protocol === 'https:' ? u.toString() : null; } catch { return null; } };

/** One AJN feed item to a card, or null when it is not trustworthy NEW material (no https url, no media type, no valid date, outside the window). */
export function cardFromFeedItem(feed: { id: string; name: string }, item: FeedItemWire, nowMs: number): DigestCard | null {
  const url = httpsUrl(item.url);
  const title = plainText(item.title);
  const mediaType = item.mediaType === 'video' || item.mediaType === 'audio' ? item.mediaType : null;
  const published = Date.parse(item.publishedAt ?? '');
  if (!url || !title || !mediaType || !item.id || Number.isNaN(published)) return null;
  if (published > nowMs + FUTURE_SLACK_MS || published < nowMs - NEW_WINDOW_MS) return null;
  return {
    key: `ajn:${feed.id}:${item.id}`, tier: 'new', showLabel: feed.name, categoryId: `ajn-${feed.id.toLowerCase()}`, title, subtitle: '',
    mediaType, path: url, thumb: httpsUrl(item.thumbnailUrl) ?? undefined, publishedMs: published,
    channelId: `ajn-feed-${feed.id.toLowerCase()}`, guideId: 'audio-podcasts', programId: String(item.id),
  };
}

export function cardFromLibrary(d: DiscoverItem): DigestCard {
  return {
    key: d.key, tier: 'library', showLabel: d.categoryLabel, categoryId: d.categoryId, title: d.title, subtitle: d.subtitle, mediaType: d.mediaType, path: d.path,
    thumb: d.thumb, durSeconds: d.durSeconds, channelId: d.channelId, guideId: d.guideId, programId: d.programId, sourceId: d.sourceId, assetId: d.assetId,
  };
}

/** "3 h ago" / "2 days ago" for a NEW card (never invents a time: callers only pass real feed dates). */
export function ageLabel(publishedMs: number, nowMs: number): string {
  const h = Math.max(0, Math.round((nowMs - publishedMs) / 3600_000));
  if (h < 1) return 'just now';
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

export interface BuildInput {
  fresh: readonly DigestCard[]; library: readonly DigestCard[]; seed: string; nowMs: number;
  dismissed: readonly string[]; exclude?: ReadonlySet<string>; limit?: number;
}
export function buildDigest(input: BuildInput): DigestCard[] {
  const { fresh, library, seed, nowMs, dismissed, limit = DIGEST_LIMIT } = input;
  const gone = new Set<string>([...dismissed, ...(input.exclude ?? [])]);
  const taken = new Set<string>();
  const out: DigestCard[] = [];

  // 1. NEW: newest first (ties by key), at most NEW_PER_SHOW per show so an hourly feed cannot take the whole row.
  const perShow = new Map<string, number>();
  const newest = fresh
    .filter((c) => c.publishedMs !== undefined && c.publishedMs <= nowMs + FUTURE_SLACK_MS && c.publishedMs >= nowMs - NEW_WINDOW_MS)
    .sort((a, b) => (b.publishedMs! - a.publishedMs!) || a.key.localeCompare(b.key));
  for (const c of newest) {
    if (out.length >= limit) break;
    if (gone.has(c.key) || taken.has(c.key)) continue;
    const n = perShow.get(c.showLabel) ?? 0; if (n >= NEW_PER_SHOW) continue;
    perShow.set(c.showLabel, n + 1); taken.add(c.key); out.push({ ...c, tier: 'new' });
  }

  // 2. BACKFILL: whole Library, order from (local date, seed): same all day for the same seed, flips at local midnight.
  const day = `${localDateKey(new Date(nowMs))}|${seed}`;
  const pool = library.filter((c) => !gone.has(c.key));
  const queue = (type: 'video' | 'audio') => dailyOrder(pool.filter((c) => c.mediaType === type), (c) => c.key, day, `digest-${type}`);
  const lanes = { video: queue('video'), audio: queue('audio') };
  const firstType: 'video' | 'audio' = hash32(day) % 2 === 0 ? 'video' : 'audio';
  const order: Array<'video' | 'audio'> = firstType === 'video' ? ['video', 'audio'] : ['audio', 'video'];
  const perCat = new Map<string, number>();
  const idx = { video: 0, audio: 0 };
  const next = (type: 'video' | 'audio'): DigestCard | null => {
    const lane = lanes[type];
    while (idx[type] < lane.length) {
      const c = lane[idx[type]++];
      if (taken.has(c.key)) continue;
      if ((perCat.get(c.categoryId) ?? 0) >= LIBRARY_PER_CATEGORY) continue;
      return c;
    }
    return null;
  };
  let turn = 0;
  while (out.length < limit) {
    let c = next(order[turn % 2]); if (!c) c = next(order[(turn + 1) % 2]);
    if (!c) break;
    taken.add(c.key); perCat.set(c.categoryId, (perCat.get(c.categoryId) ?? 0) + 1); out.push({ ...c, tier: 'library' }); turn++;
  }
  return out;
}
