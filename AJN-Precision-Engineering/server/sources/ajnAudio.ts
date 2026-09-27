// Layer 4 — AJN Audio (hourly and segment MP3 indexes on rss.alexjones.media).
// The publisher only offers these indexes as HTML, so href parsing stays in
// ajnResourceService.parseAudioIndexItems. This hook owns fetch, identity and status.
// - Identity: URL without query string, so CDN token rotation keeps the same program.
// - Air time: only when the filename carries a date; otherwise marked unknown, never "now".
// - HTTP 401/403 from the index: 'restricted' (known publisher restriction), not an error.
import type { Program } from '../../src/types';
import { normalizeAssetIdentity, normalizeProgramIdentity } from '../../src/utils/epgIdentity';
import { getAjnAudioIndexes, parseAudioIndexItems } from '../../ajnResourceService';
import type { RejectedItem, SourceContract, SourceResult } from './contract';

export interface AjnAudioInput {
  kind: 'hourly' | 'segment';
  guideId?: string;
  maxItems?: number;
  fetchImpl?: typeof fetch;
}

const INDEX_URLS = { hourly: 'https://rss.alexjones.media/mp3-hourly.html', segment: 'https://rss.alexjones.media/mp3-segs.html' };

/** Date from filenames like show_2026-09-22_hr1.mp3, 20260922-hour2.mp3. UTC midnight + hour if present. */
export function airDateFromFilename(name: string): Date | null {
  const m = name.match(/(20\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])/);
  if (!m) return null;
  const hour = name.match(/(?:hr|hour)[-_ ]?(\d{1,2})\b/i);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], hour ? Math.min(+hour[1], 23) : 0));
  return Number.isFinite(d.getTime()) ? d : null;
}

export const ajnAudioContract: SourceContract<AjnAudioInput> = {
  sourceClass: 'ajn_audio',
  priority: 4,
  async hook(input, ctx): Promise<SourceResult> {
    const fetchImpl = input.fetchImpl ?? fetch;
    const index = getAjnAudioIndexes().find((i) => i.kind === input.kind);
    const base = { sourceClass: 'ajn_audio' as const, fetchedAt: ctx.now.toISOString() };
    if (!index) return { ...base, status: 'offline', programs: [], rejected: [], error: `unknown audio index ${input.kind}` };

    const res = await fetchImpl(INDEX_URLS[input.kind], {
      signal: ctx.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AJN-Precision-Engineering/1.0)', Accept: 'text/html' },
    });
    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel().catch(() => {});
      return { ...base, status: 'restricted', programs: [], rejected: [], error: `audio index ${input.kind} HTTP ${res.status}` };
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { ...base, status: 'upstream_error', programs: [], rejected: [], error: `audio index ${input.kind} HTTP ${res.status}` };
    }

    const items = parseAudioIndexItems(await res.text(), index).slice(0, input.maxItems ?? 200);
    const programs: Program[] = [];
    const rejected: RejectedItem[] = [];
    const channelId = `ajn-audio-${input.kind}`;

    for (const item of items) {
      if (!/^https:\/\//i.test(item.url)) { rejected.push({ id: item.id, reason: 'audio URL is not HTTPS' }); continue; }
      const filename = item.id.split('/').pop() ?? '';
      const aired = airDateFromFilename(decodeURIComponent(filename));
      const programId = normalizeProgramIdentity({ externalId: item.id, channelId, title: item.title, startTime: 0 });
      programs.push({
        id: programId,
        guideId: input.guideId ?? 'audio-podcasts',
        channelId,
        title: item.title,
        description: `AJN audio ${input.kind}`,
        startTime: aired ? aired.getTime() : 0,
        endTime: aired ? aired.getTime() + 3600_000 : 0,
        ...(aired ? { startTimeUtc: aired.toISOString(), endTimeUtc: new Date(aired.getTime() + 3600_000).toISOString() } : {}),
        mediaType: 'audio',
        mediaUrl: item.url,
        assetId: normalizeAssetIdentity({ externalId: item.id, programId, mediaUrl: item.id }),
        sourceClass: 'ajn_archive',
        isArchivedSource: true,
        metadata: {
          externalId: item.id,
          resourceKind: input.kind,
          sourceIndex: index.url,
          airDateSource: aired ? 'filename' : 'unknown',
        },
      });
    }

    const status: SourceResult['status'] = programs.length > 0 ? (rejected.length ? 'partial' : 'ok') : rejected.length ? 'partial' : 'ok';
    return { ...base, status, programs, rejected };
  },
};
