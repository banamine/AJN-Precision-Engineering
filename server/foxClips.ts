// "Police Chase" channel (group "FOX Clips") for Cable TV: direct MP4 clips from livenowfox.com / static-clips.fox.com.
// On-demand video, NOT live and NOT Archive: ids start "fox-clip-", every program is metadata.externalClip (the Library skips them),
// no sourceClass. Clips rotate daily through layoutRotatingDailySchedule using each clip's real length (read from the file header).
// Data: server/data/foxClips.json (browser-playback tested). Kept fresh by server/foxClipsRefresh.ts (every 24 h).
import type { Program, ScheduleChannel } from '../src/types';
import { normalizeAssetIdentity, normalizeSourceIdentity } from '../src/utils/epgIdentity';
import { layoutRotatingDailySchedule } from './dailyRotation';
import foxJson from './data/foxClips.json';

export const FOX_CLIPS_GROUP = 'FOX Clips';
export const FOX_CLIPS_CHANNEL_ID = 'fox-clips-police-chase';
export const FOX_CLIPS_CHANNEL_NAME = 'Police Chase';
export const FOX_CLIP_ID_PREFIX = 'fox-clip-';
export const FOX_MP4_HOST = 'static-clips.fox.com';
export const FOX_PAGE_HOST = 'www.livenowfox.com';
const THUMB_HOSTS = new Set(['images.foxtv.com', 'static-media.fox.com']);
const okThumb = (u: unknown): u is string => { try { const x = new URL(String(u)); return x.protocol === 'https:' && THUMB_HOSTS.has(x.hostname) && String(u).length <= 290; } catch { return false; } };

export interface FoxClip {
  id: string; pageUrl: string; title: string; uploaded?: string; mp4: string; seconds: number; size: number;
  etag?: string; lastModified?: string; verifiedAt: string; thumb?: string;
}

const MIN_SECONDS = 20, MAX_SECONDS = 4 * 3600;

export function validateFoxClips(raw: unknown[]): { valid: FoxClip[]; rejected: Array<{ id: string; reason: string }> } {
  const valid: FoxClip[] = [], rejected: Array<{ id: string; reason: string }> = [];
  const ids = new Set<string>(), urls = new Set<string>();
  for (const item of Array.isArray(raw) ? raw : []) {
    const s = (item ?? {}) as Record<string, unknown>;
    const id = typeof s.id === 'string' ? s.id.trim() : '';
    const rej = (reason: string) => rejected.push({ id: id || 'unknown', reason });
    if (!/^\d{5,9}$/.test(id)) { rej('id must be the numeric FOX video id'); continue; }
    if (ids.has(id)) { rej('duplicate id'); continue; }
    ids.add(id);
    const title = typeof s.title === 'string' ? s.title.trim() : '';
    if (!title) { rej('missing title'); continue; }
    let mp4: URL;
    try { mp4 = new URL(String(s.mp4)); } catch { rej('bad mp4 url'); continue; }
    if (mp4.protocol !== 'https:' || mp4.hostname !== FOX_MP4_HOST || mp4.port || !/\.mp4$/i.test(mp4.pathname)) { rej(`mp4 must be https://${FOX_MP4_HOST}/….mp4`); continue; }
    if (urls.has(mp4.href)) { rej('duplicate mp4 url'); continue; }
    urls.add(mp4.href);
    const seconds = Number(s.seconds);
    if (!Number.isFinite(seconds) || seconds < MIN_SECONDS || seconds > MAX_SECONDS) { rej('length must be 20 s to 4 h'); continue; }
    if (typeof s.verifiedAt !== 'string' || !s.verifiedAt.trim()) { rej('not verified'); continue; }
    valid.push({
      id, title, mp4: mp4.href, seconds, size: Number(s.size) || 0, verifiedAt: s.verifiedAt,
      pageUrl: `https://${FOX_PAGE_HOST}/video/${id}`,
      ...(okThumb(s.thumb) ? { thumb: s.thumb } : {}),
      ...(typeof s.uploaded === 'string' ? { uploaded: s.uploaded } : {}),
      ...(typeof s.etag === 'string' ? { etag: s.etag } : {}),
      ...(typeof s.lastModified === 'string' ? { lastModified: s.lastModified } : {}),
    });
  }
  return { valid, rejected };
}

export function foxClipSeed(): unknown[] { return (foxJson as { clips?: unknown[] }).clips ?? []; }

/** One channel; [] when there are no clips (the group then simply does not appear). */
export function getFoxClipsChannels(guideId: string, now: Date = new Date(), rawOverride?: unknown[]): ScheduleChannel[] {
  const { valid } = validateFoxClips(rawOverride ?? foxClipSeed());
  if (!valid.length) return [];
  const sorted = [...valid].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  const base = sorted.map((c) => {
    const programId = `${FOX_CLIP_ID_PREFIX}${c.id}`;
    return {
      id: programId, guideId, channelId: FOX_CLIPS_CHANNEL_ID, title: c.title,
      description: `FOX clip${c.uploaded ? ` · ${c.uploaded}` : ''}`,
      startTime: 0, endTime: 0, startHour: 0, endHour: 0,
      startTimeUtc: new Date(0).toISOString(), endTimeUtc: new Date(c.seconds * 1000).toISOString(),
      mediaType: 'video', mediaUrl: c.mp4,
      assetId: normalizeAssetIdentity({ externalId: c.mp4, programId, mediaUrl: c.mp4 }),
      sourceId: normalizeSourceIdentity({ channelId: FOX_CLIPS_CHANNEL_ID, url: c.pageUrl, protocol: 'direct_mp4' }),
      isArchivedSource: false,
      metadata: { externalId: c.mp4, group: FOX_CLIPS_GROUP, durationSeconds: c.seconds, externalClip: true, source: 'livenowfox.com', pageUrl: c.pageUrl, uploaded: c.uploaded, thumb: c.thumb },
    } as Program;
  });
  return [{
    id: FOX_CLIPS_CHANNEL_ID, guideId, name: FOX_CLIPS_CHANNEL_NAME, mediaType: 'video' as const, group: FOX_CLIPS_GROUP,
    programs: layoutRotatingDailySchedule(base, 10, now),
  }];
}
