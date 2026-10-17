// Live news streams for the Cable TV guide (group "Live News").
// These are live HLS feeds, never Archive on-demand video: ids start with "live-news-", every program is
// metadata.live (so the Library and its index skip them) and names that match an Archive Cable TV channel carry " LIVE".
// Data: server/data/liveNewsChannels.json (curated snapshot of https://livenow.news/index.m3u, header-probed).
import type { Program, ScheduleChannel } from '../src/types';
import { normalizeAssetIdentity, normalizeProgramIdentity, normalizeSourceIdentity } from '../src/utils/epgIdentity';
import liveNewsJson from './data/liveNewsChannels.json';

export const LIVE_NEWS_GROUP = 'Live News';
export const LIVE_NEWS_ID_PREFIX = 'live-news-';

export interface LiveNewsRecord {
  id: string;
  tvgId?: string;
  name: string;
  logo?: string;
  url: string;
  verifiedAt: string;
}

const isHlsUrl = (u: string) => /^https:\/\/[^\s]+\.m3u8(\?|$)/i.test(u);

export function validateLiveNews(raw: unknown[]): { valid: LiveNewsRecord[]; rejected: Array<{ id: string; reason: string }> } {
  const valid: LiveNewsRecord[] = [];
  const rejected: Array<{ id: string; reason: string }> = [];
  const ids = new Set<string>();
  const urls = new Set<string>();
  for (const item of Array.isArray(raw) ? raw : []) {
    const s = (item ?? {}) as Record<string, unknown>;
    const id = typeof s.id === 'string' ? s.id.trim() : '';
    const name = typeof s.name === 'string' ? s.name.trim() : '';
    const url = typeof s.url === 'string' ? s.url.trim() : '';
    if (!id.startsWith(LIVE_NEWS_ID_PREFIX)) { rejected.push({ id: id || 'unknown', reason: `id must start with ${LIVE_NEWS_ID_PREFIX}` }); continue; }
    if (ids.has(id)) { rejected.push({ id, reason: 'duplicate id' }); continue; }
    ids.add(id);
    if (!name) { rejected.push({ id, reason: 'missing name' }); continue; }
    if (!isHlsUrl(url)) { rejected.push({ id, reason: 'stream must be an https .m3u8 URL' }); continue; }
    if (urls.has(url)) { rejected.push({ id, reason: 'duplicate stream URL' }); continue; }
    urls.add(url);
    if (typeof s.verifiedAt !== 'string' || !s.verifiedAt.trim()) { rejected.push({ id, reason: 'not verified' }); continue; }
    const logo = typeof s.logo === 'string' && s.logo.startsWith('https://') && s.logo.length <= 290 ? s.logo : undefined;
    valid.push({ id, name, url, verifiedAt: s.verifiedAt, ...(typeof s.tvgId === 'string' ? { tvgId: s.tvgId } : {}), ...(logo ? { logo } : {}) });
  }
  return { valid, rejected };
}

/** One 24-hour live program per channel, shaped exactly like the Live TV guide's m3u_live programs. */
export function getLiveNewsChannels(guideId: string, now: Date = new Date(), rawOverride?: unknown[], reservedNames: Iterable<string> = []): ScheduleChannel[] {
  const raw = rawOverride ?? ((liveNewsJson as { channels?: unknown[] }).channels ?? []);
  // A live channel whose name equals an Archive (VOD) channel name always carries " LIVE": the two are never confused.
  const reserved = new Set([...reservedNames].map((n) => n.trim().toLowerCase()));
  const valid = validateLiveNews(raw).valid.map((c) => (reserved.has(c.name.toLowerCase()) && !/ LIVE$/.test(c.name) ? { ...c, name: `${c.name} LIVE` } : c));
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const source = (liveNewsJson as { source?: string }).source ?? 'https://livenow.news/index.m3u';
  return valid.map((c) => {
    const programId = normalizeProgramIdentity({ externalId: `${c.id}|live`, channelId: c.id, title: c.name, startTime: new Date(day).toISOString() });
    const program = {
      id: programId,
      guideId,
      channelId: c.id,
      title: c.name,
      description: `Live · ${LIVE_NEWS_GROUP}`,
      startTime: 0, endTime: 24, startHour: 0, endHour: 24,
      startTimeUtc: new Date(day).toISOString(),
      endTimeUtc: new Date(day + 86_400_000).toISOString(),
      mediaType: 'video',
      mediaUrl: c.url,
      assetId: normalizeAssetIdentity({ externalId: c.url, programId, mediaUrl: c.url }),
      sourceId: normalizeSourceIdentity({ channelId: c.id, url: source, protocol: 'm3u' }),
      sourceClass: 'm3u_live',
      isArchivedSource: false,
      metadata: { externalId: c.url, group: LIVE_NEWS_GROUP, logo: c.logo, tvgId: c.tvgId, live: true, source },
    } as Program;
    return { id: c.id, guideId, name: c.name, mediaType: 'video' as const, group: LIVE_NEWS_GROUP, ...(c.logo ? { logo: c.logo } : {}), programs: [program] };
  });
}
