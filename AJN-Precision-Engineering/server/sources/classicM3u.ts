// Layer 1 — Classic TV M3U. Regex lives here because the input is text.
// Identity is show + season + episode when the title carries SxxEyy, else show + title.
import type { Program } from '../../src/types';
import { normalizeAssetIdentity, normalizeProgramIdentity, normalizeSourceIdentity } from '../../src/utils/epgIdentity';
import type { SourceContract, RejectedItem } from './contract';
import { statusFrom } from './contract';

export interface ClassicM3uInput {
  playlistId: string;
  guideId: string;
  text: string;
}

export interface ParsedEntry {
  title: string;
  url: string;
  duration: number;
  groupTitle?: string;
  tvgId?: string;
  tvgName?: string;
  tvgLogo?: string;
}

const EPISODE_RE = /\bS(\d{1,2})\s*E(\d{1,3})\b/i;
const ALT_EPISODE_RE = /\b(\d{1,2})x(\d{1,3})\b/;

export function parseM3uEntries(text: string): ParsedEntry[] {
  const out: ParsedEntry[] = [];
  let cur: Partial<ParsedEntry> | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      const attr = (name: string) => line.match(new RegExp(`${name}="([^"]*)"`, 'i'))?.[1];
      const comma = line.lastIndexOf(',');
      cur = {
        title: comma >= 0 ? line.slice(comma + 1).trim() : '',
        duration: Number(line.match(/^#EXTINF:(-?\d+(?:\.\d+)?)/)?.[1] ?? 0),
        groupTitle: attr('group-title'),
        tvgId: attr('tvg-id'),
        tvgName: attr('tvg-name'),
        tvgLogo: attr('tvg-logo'),
      };
    } else if (!line.startsWith('#') && cur) {
      out.push({ ...(cur as ParsedEntry), url: line });
      cur = null;
    }
  }
  return out;
}

export function episodeKey(entry: ParsedEntry): { show: string; season?: number; episode?: number } {
  const show = (entry.groupTitle || entry.tvgName || 'Unsorted').trim();
  const m = entry.title.match(EPISODE_RE) ?? entry.title.match(ALT_EPISODE_RE);
  return m ? { show, season: Number(m[1]), episode: Number(m[2]) } : { show };
}

const PLAYABLE_URL = /^(https?:\/\/|\/download\/)/i;

export const classicM3uContract: SourceContract<ClassicM3uInput> = {
  sourceClass: 'classic_m3u',
  priority: 1,
  async hook(input, ctx) {
    const programs: Program[] = [];
    const rejected: RejectedItem[] = [];
    const seen = new Set<string>();

    for (const entry of parseM3uEntries(input.text)) {
      const key = episodeKey(entry);
      const channelId = `m3u:${key.show.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      const externalId = key.season !== undefined
        ? `${key.show}|S${key.season}E${key.episode}`
        : `${key.show}|${entry.title}`;

      if (!entry.title) { rejected.push({ id: entry.url, reason: 'EXTINF has no title' }); continue; }
      if (!PLAYABLE_URL.test(entry.url)) { rejected.push({ id: externalId, reason: `unsupported URL scheme: ${entry.url.slice(0, 40)}` }); continue; }
      if (seen.has(externalId)) { rejected.push({ id: externalId, reason: 'duplicate episode in playlist' }); continue; }
      seen.add(externalId);

      const programId = normalizeProgramIdentity({ externalId, channelId, title: entry.title, startTime: 0 });
      programs.push({
        id: programId,
        guideId: input.guideId,
        channelId,
        title: entry.title,
        startTime: 0,
        endTime: 0,
        mediaType: /\.(mp3|m4a|aac|ogg)(\?|$)/i.test(entry.url) ? 'audio' : 'video',
        mediaUrl: entry.url,
        assetId: normalizeAssetIdentity({ externalId, programId, mediaUrl: entry.url }),
        sourceId: normalizeSourceIdentity({ channelId, url: `playlist:${input.playlistId}`, protocol: 'm3u' }),
        metadata: {
          externalId,
          show: key.show,
          season: key.season,
          episode: key.episode,
          durationSeconds: entry.duration > 0 ? entry.duration : undefined,
          tvgId: entry.tvgId,
          logo: entry.tvgLogo,
        },
      });
    }

    return {
      sourceClass: 'classic_m3u',
      status: statusFrom(programs.length, rejected.length),
      programs,
      rejected,
      fetchedAt: ctx.now.toISOString(),
    };
  },
};
