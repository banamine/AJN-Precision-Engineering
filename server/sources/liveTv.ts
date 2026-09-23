// Layer 6 — Live TV. Public M3U channel lists fetched at runtime and refreshed
// on a schedule, so the guide always follows the upstream list.
//
// Only sources that publish free, public streams are accepted by default
// (iptv-org). Credentialed panel restreams (Xtream-style /user/pass/id URLs)
// are rejected: they are resold cable feeds, not public streams.
// Plain-http streams are rejected too: an https page cannot play them.
import type { Program } from '../../src/types';
import { normalizeAssetIdentity, normalizeProgramIdentity, normalizeSourceIdentity } from '../../src/utils/epgIdentity';
import { parseM3uEntries } from './classicM3u';
import { slug } from './archiveLinks';
import type { RejectedItem, SourceContract, SourceResult } from './contract';

export const DEFAULT_LIVE_SOURCES = ['https://iptv-org.github.io/iptv/countries/us.m3u'];
export const LIVE_REFRESH_MS = 6 * 3600_000;

export interface LiveTvInput { guideId: string; sources?: string[]; fetchImpl?: typeof fetch }
export interface LiveChannel { id: string; name: string; group: string; logo?: string; program: Program }

/** Xtream-Codes style panel URL: host:port/user/pass/streamId (credentials in the path). */
const PANEL_RESTREAM = /^https?:\/\/[^/]+:\d+\/[^/]+\/[^/]+\/\d+(\.\w+)?$/i;
const ADULT_GROUP = /\b(xxx|adult)\b/i;

export function checkLiveUrl(url: string): string | null {
  if (!/^https:\/\//i.test(url)) return 'not https (blocked as mixed content on an https page)';
  if (PANEL_RESTREAM.test(url)) return 'credentialed panel restream';
  return null;
}

export function sourcesFromEnv(env = process.env.LIVE_TV_SOURCES): string[] {
  const list = String(env ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_LIVE_SOURCES;
}

export const liveTvContract: SourceContract<LiveTvInput> = {
  sourceClass: 'live_tv',
  priority: 6,
  async hook(input, ctx): Promise<SourceResult> {
    const fetchImpl = input.fetchImpl ?? fetch;
    const sources = input.sources ?? sourcesFromEnv();
    const programs: Program[] = [];
    const rejected: RejectedItem[] = [];
    const errors: string[] = [];
    const seenUrl = new Set<string>();
    const day = Date.UTC(ctx.now.getUTCFullYear(), ctx.now.getUTCMonth(), ctx.now.getUTCDate());

    for (const source of sources) {
      let text: string;
      try {
        const r = await fetchImpl(source, { signal: ctx.signal, headers: { 'User-Agent': 'AJN-Precision-Engineering/LiveTV' } });
        if (!r.ok) { await r.body?.cancel().catch(() => {}); errors.push(`${source} HTTP ${r.status}`); continue; }
        text = await r.text();
      } catch (err: any) { errors.push(`${source} ${String(err?.message ?? err)}`); continue; }

      for (const entry of parseM3uEntries(text)) {
        const name = entry.title.trim();
        const group = (entry.groupTitle || 'Undefined').split(';')[0].trim() || 'Undefined';
        if (!name) continue;
        if (ADULT_GROUP.test(entry.groupTitle ?? '')) { rejected.push({ id: name, reason: 'adult group' }); continue; }
        const bad = checkLiveUrl(entry.url);
        if (bad) { rejected.push({ id: name, reason: bad }); continue; }
        if (seenUrl.has(entry.url)) continue;
        seenUrl.add(entry.url);

        const channelId = `live-${slug(entry.tvgId || name)}`;
        const programId = normalizeProgramIdentity({ externalId: `${channelId}|live`, channelId, title: name, startTime: new Date(day).toISOString() });
        programs.push({
          id: programId,
          guideId: input.guideId,
          channelId,
          title: name,
          description: `Live · ${group}`,
          startTime: 0, endTime: 24, startHour: 0, endHour: 24,
          startTimeUtc: new Date(day).toISOString(),
          endTimeUtc: new Date(day + 86_400_000).toISOString(),
          mediaType: 'video',
          mediaUrl: entry.url,
          assetId: normalizeAssetIdentity({ externalId: entry.url, programId, mediaUrl: entry.url }),
          sourceId: normalizeSourceIdentity({ channelId, url: source, protocol: 'm3u' }),
          sourceClass: 'm3u_live',
          isArchivedSource: false,
          metadata: { externalId: entry.url, group, logo: entry.tvgLogo, tvgId: entry.tvgId, live: true, source },
        } as Program);
      }
    }

    const base = { sourceClass: 'live_tv' as const, fetchedAt: ctx.now.toISOString(), programs, rejected };
    if (programs.length === 0 && errors.length) return { ...base, status: 'upstream_error', error: errors.join('; ') };
    return { ...base, status: errors.length || rejected.length ? 'partial' : 'ok', ...(errors.length ? { error: errors.join('; ') } : {}) };
  },
};
