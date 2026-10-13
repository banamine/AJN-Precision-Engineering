/* "On now" for the Home carousel: ONE currently-airing program per guide (genre), read from the cached guide
 * snapshots. A pure reader: it never searches Archive and never invents a program. The pick among several
 * airing channels is deterministic (guide id + hour bucket), so every viewer sees the same item within an hour. */
import type { ScheduleChannel } from '../src/types';

export interface HomeNowItem {
  guideId: string;
  guideName: string;
  channelId: string;
  channelName: string;
  title: string;
  startTimeUtc: string;
  endTimeUtc: string;
  mediaType: 'video' | 'audio';
  archivePath: string;
  programId: string;
  sourceId?: string;
  assetId?: string;
  /** Archive cover (through our own proxy) when the program is an Archive item; else the channel logo; else undefined. */
  thumb?: string;
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Archive item cover through /api/archive/proxy, the same path rule every other Archive request uses. */
export function archiveCoverFor(archivePath: string): string | undefined {
  const m = /^\/download\/([^/]+)\//.exec(archivePath);
  return m ? `/api/archive/proxy?path=${encodeURIComponent(`/download/${m[1]}/__ia_thumb.jpg`)}` : undefined;
}

export function pickOnNow(guideId: string, guideName: string, channels: ScheduleChannel[], nowMs: number): HomeNowItem | null {
  const airing: HomeNowItem[] = [];
  for (const ch of channels) {
    if (ch.sourceStatus && ch.sourceStatus !== 'ok') continue;
    for (const p of ch.programs ?? []) {
      const s = Date.parse(p.startTimeUtc ?? '');
      const e = Date.parse(p.endTimeUtc ?? '');
      if (!Number.isFinite(s) || !Number.isFinite(e) || !(s <= nowMs && nowMs < e)) continue;
      const path = p.archivePath || p.mediaUrl || '';
      if (!path) continue;
      airing.push({
        guideId, guideName, channelId: ch.id, channelName: ch.name, title: p.title,
        startTimeUtc: p.startTimeUtc!, endTimeUtc: p.endTimeUtc!,
        mediaType: ch.mediaType === 'audio' ? 'audio' : 'video',
        archivePath: path, programId: p.id, sourceId: p.sourceId, assetId: p.assetId,
        thumb: archiveCoverFor(p.archivePath ?? '') ?? (typeof ch.logo === 'string' && ch.logo.startsWith('/') ? ch.logo : undefined),
      });
      break; // one airing program per channel is enough
    }
  }
  if (airing.length === 0) return null;
  airing.sort((a, b) => a.channelId.localeCompare(b.channelId));
  const hourBucket = Math.floor(nowMs / 3_600_000);
  return airing[hashString(`${guideId}|${hourBucket}`) % airing.length];
}
