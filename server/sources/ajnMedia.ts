// Layer 5 — AJN Media (RSS feeds on rss.alexjones.media: Alex, WarRoom, SundayLive, hourly).
// - Identity: the RSS <guid>, namespaced by feed. No guid -> enclosure URL without query.
// - Air time: <pubDate>. Missing/invalid -> rejected (an RSS item we can't place is not
//   guessed as "now").
// - Retention: items older than retentionDays are rejected with a reason, not silently dropped.
// - Duration: itunes:duration when present (durationSource=rss), else 1h marked 'estimated'.
import type { Program } from '../../src/types';
import { normalizeAssetIdentity, normalizeProgramIdentity } from '../../src/utils/epgIdentity';
import { getAjnResource, parseAjnFeedXml, type AjnFeedId } from '../../ajnResourceService';
import type { RejectedItem, SourceContract, SourceResult } from './contract';

export interface AjnMediaInput {
  feedId: AjnFeedId;
  guideId?: string;
  retentionDays?: number;
  fetchImpl?: typeof fetch;
}

/** itunes:duration as seconds: "3600", "59:30", "1:02:03". */
export function parseItunesDuration(value?: string): number | undefined {
  if (!value) return undefined;
  const parts = value.trim().split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return undefined;
  const seconds = parts.reduce((acc, n) => acc * 60 + n, 0);
  return seconds > 0 ? seconds : undefined;
}

export const ajnMediaContract: SourceContract<AjnMediaInput> = {
  sourceClass: 'ajn_media',
  priority: 5,
  async hook(input, ctx): Promise<SourceResult> {
    const fetchImpl = input.fetchImpl ?? fetch;
    const resource = getAjnResource(input.feedId);
    const base = { sourceClass: 'ajn_media' as const, fetchedAt: ctx.now.toISOString() };
    if (!resource) return { ...base, status: 'offline', programs: [], rejected: [], error: `unknown AJN feed ${input.feedId}` };

    const res = await fetchImpl(resource.rssUrl, {
      signal: ctx.signal,
      headers: { 'User-Agent': 'AJN-Precision-Engineering/1.0', Accept: 'application/rss+xml, application/xml, text/xml' },
    });
    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel().catch(() => {});
      return { ...base, status: 'restricted', programs: [], rejected: [], error: `feed ${input.feedId} HTTP ${res.status}` };
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { ...base, status: 'upstream_error', programs: [], rejected: [], error: `feed ${input.feedId} HTTP ${res.status}` };
    }
    const xml = await res.text();
    if (!/<(?:rss|feed)\b/i.test(xml)) {
      return { ...base, status: 'upstream_error', programs: [], rejected: [], error: `feed ${input.feedId} did not return RSS/XML` };
    }

    const retentionDays = input.retentionDays ?? 7;
    const oldest = ctx.now.getTime() - retentionDays * 86_400_000;
    const channelId = `ajn-feed-${input.feedId.toLowerCase()}`;
    const programs: Program[] = [];
    const rejected: RejectedItem[] = [];
    const seen = new Set<string>();

    for (const item of parseAjnFeedXml(xml, resource)) {
      const guid = item.metadata.guid?.trim();
      const externalId = guid ? `${input.feedId}:${guid}` : `${input.feedId}:${item.url.split('#')[0].split('?')[0]}`;
      if (seen.has(externalId)) { rejected.push({ id: externalId, reason: 'duplicate guid in feed' }); continue; }
      seen.add(externalId);

      const published = item.publishedAt ? Date.parse(item.publishedAt) : NaN;
      if (!Number.isFinite(published)) { rejected.push({ id: externalId, reason: 'missing or invalid pubDate' }); continue; }
      if (published < oldest) { rejected.push({ id: externalId, reason: `older than ${retentionDays}-day retention window` }); continue; }
      if (published > ctx.now.getTime() + 3600_000) { rejected.push({ id: externalId, reason: 'pubDate is in the future' }); continue; }
      if (!/^https:\/\//i.test(item.url)) { rejected.push({ id: externalId, reason: 'media URL is not HTTPS' }); continue; }

      const durationSeconds = parseItunesDuration(item.duration);
      const start = new Date(published);
      const end = new Date(published + (durationSeconds ?? 3600) * 1000);
      const programId = normalizeProgramIdentity({ externalId, channelId, title: item.title, startTime: start.toISOString() });
      programs.push({
        id: programId,
        guideId: input.guideId ?? 'audio-podcasts',
        channelId,
        title: item.title,
        description: item.description,
        startTime: start.getTime(),
        endTime: end.getTime(),
        startTimeUtc: start.toISOString(),
        endTimeUtc: end.toISOString(),
        mediaType: item.mediaType,
        mediaUrl: item.url,
        assetId: normalizeAssetIdentity({ externalId, programId, mediaUrl: externalId }),
        sourceClass: 'ajn_rss',
        isArchivedSource: false,
        metadata: {
          externalId,
          guid,
          feedId: input.feedId,
          sourceFeed: resource.rssUrl,
          durationSeconds,
          durationSource: durationSeconds ? 'rss' : 'estimated',
        },
      });
    }

    programs.sort((a, b) => b.startTime - a.startTime);
    const status: SourceResult['status'] = programs.length > 0 ? (rejected.length ? 'partial' : 'ok') : rejected.length ? 'partial' : 'ok';
    return { ...base, status, programs, rejected };
  },
};
