// Pure helpers for "never leave playback idle". No I/O, no clock reads (callers pass `nowMs`).
// Order of preference when something ends or fails:
//   1. the next item of what is playing (playlist / series / channel / library list)   -> handled by the caller
//   2. another playable video or audio item from the app's guides                       -> pickAnotherItem
//   3. AJN Full Shows audio (newest whole show of each AJN show), looped                -> fullShowTargets + nextInLoop
import type { LatestFullShow } from './latestFullShows.ts';
import type { RadioEntry } from './ajnRadioCatalog.ts';

export interface PlayTarget {
  src: string; title: string; description: string; mediaType: string;
  channelId?: string; guideId?: string; programId?: string; sourceId?: string; assetId?: string;
}
export interface Playing { src?: string; archivePath?: string; programId?: string; assetId?: string }

/** Smallest guides first: the answer should come back quickly even on a slow link. */
export const GUIDE_FALLBACK_ORDER = ['movies-classics-vault', 'old-british-tv', 'cable-tv', 'science-documentaries', 'audio-podcasts', 'classic-tv'] as const;

export const targetKey = (t: { programId?: string; assetId?: string; src?: string; archivePath?: string }): string =>
  String(t.programId || t.assetId || t.archivePath || t.src || '');

/** A schedule program as a play target, or null when it has no media reference. */
export function programTarget(p: any, guideId?: string, channelId?: string): PlayTarget | null {
  const src = String(p?.archivePath || p?.mediaUrl || '').trim();
  if (!src) return null;
  return {
    src, title: String(p.title ?? 'Untitled'), description: String(p.description ?? ''),
    mediaType: String(p.mediaType ?? ''), channelId: p.channelId ?? channelId, guideId: p.guideId ?? guideId,
    programId: p.id, sourceId: p.sourceId ?? p.metadata?.sourceId, assetId: p.assetId ?? p.metadata?.assetId,
  };
}

/** Another playable item from fetched guide schedules: prefers the program on air at `nowMs`, never the current item or a failed one. */
export function pickAnotherItem(
  schedules: ReadonlyArray<{ guideId: string; channels: any[] }>,
  current: Playing, failed: ReadonlySet<string>, nowMs: number,
): PlayTarget | null {
  const curKey = targetKey(current);
  const ok = (t: PlayTarget | null): t is PlayTarget => !!t && targetKey(t) !== curKey && t.src !== current.src && !failed.has(targetKey(t));
  for (const s of schedules) {
    let firstOk: PlayTarget | null = null;
    for (const ch of s.channels ?? []) {
      for (const p of ch.programs ?? []) {
        const t = programTarget(p, s.guideId, ch.id);
        if (!ok(t)) continue;
        const a = Date.parse(p.startTimeUtc), b = Date.parse(p.endTimeUtc);
        if (Number.isFinite(a) && Number.isFinite(b) && a <= nowMs && nowMs < b) return t; // on air now
        firstOk ??= t;
      }
    }
    if (firstOk) return firstOk;
  }
  return null;
}

/** The AJN Full Shows audio loop: newest whole show of each AJN show, as audio targets. */
export function fullShowTargets(shows: readonly LatestFullShow[]): PlayTarget[] {
  return shows.filter((s) => s.url).map((s) => ({
    src: s.url, title: s.title, description: `Full show · ${s.showName} · ${s.dateLabel}`, mediaType: 'audio',
    channelId: 'ajn-radio', guideId: 'ajn-radio', programId: s.id,
  }));
}

/** The item after `currentKey`, wrapping to the first (a one-item list returns itself: the loop). Skips failed items; null only if all failed. */
export function nextInLoop<T extends { src: string; programId?: string }>(list: readonly T[], currentKey: string, failed: ReadonlySet<string>): T | null {
  if (!list.length) return null;
  const i = list.findIndex((t) => targetKey(t) === currentKey);
  for (let step = 1; step <= list.length; step++) {
    const t = list[((i < 0 ? -1 : i) + step) % list.length];
    if (!failed.has(targetKey(t))) return t;
  }
  return null;
}

/** Next AJN Radio entry after the playing one (list order, wrapping). Plays video only when the current item is video and the next has a video file. */
export function radioNext(entries: readonly RadioEntry[], programId: string | undefined, wantVideo: boolean, failed: ReadonlySet<string>): PlayTarget | null {
  if (!entries.length) return null;
  const base = String(programId ?? '').replace(/:video$/, '');
  const i = entries.findIndex((e) => e.id === base);
  for (let step = 1; step <= entries.length; step++) {
    const e = entries[((i < 0 ? -1 : i) + step) % entries.length];
    const video = wantVideo && !!e.videoUrl;
    const t: PlayTarget = { src: video ? e.videoUrl! : e.audioUrl, title: e.title, description: 'AJN Radio', mediaType: video ? 'video' : 'audio',
      channelId: 'ajn-radio', guideId: 'ajn-radio', programId: video ? `${e.id}:video` : e.id };
    if (t.src && !failed.has(targetKey(t))) return t;
  }
  return null;
}
