// Pure: groups the Radio catalog into one entry per show-day and plans a "Full Show" as an ordered list of REAL parts.
// No I/O, no clock. Counts are derived from the published files (Alex may have 4 hours, War Room 3, Sunday fewer):
// nothing is hard-coded, gaps are reported, and a short list is never presented as the complete show.
import type { RadioEntry } from './ajnRadioCatalog.ts';
import { formatAirDate } from './ajnClassify.ts';

export type FullShowMode = 'audio' | 'video';
/** Saturday is a Special Broadcast; Sunday carries the regular line-up (Alex hours + Sunday Night Live). Other days are regular. */
export type DayKind = 'special' | 'sunday-lineup' | 'weekday';

export interface ShowPart { hour: number; entryId: string; audioUrl: string; videoUrl: string | null }
export interface ShowDay {
  key: string;                 // `${airDate}|${showSlug}`
  showSlug: string;
  showName: string;
  airDate: string;             // YYYY-MM-DD (undated entries are never grouped: no guessed dates)
  dayKind: DayKind;
  /** One whole-show audio file (no -HrN), when the feed has it. */
  full: RadioEntry | null;
  /** A single-file special (Saturday / "-Special"): audio, and video if paired. */
  special: RadioEntry | null;
  parts: ShowPart[];           // hours that exist, ascending
}

export interface PlanItem {
  src: string; mediaType: 'audio' | 'video'; programId: string; title: string;
  partNo: number; totalParts: number;
}
export interface FullShowPlan {
  mode: FullShowMode;
  items: PlanItem[];
  /** Hours inside 1..highest that cannot play in this mode (e.g. no video file). Reported, never silently skipped. */
  missingHours: number[];
  /** True when one file is the whole show (single audio file or a special). */
  singleFile: boolean;
  playable: boolean;
  /** Why nothing can play, when playable is false. */
  reason?: string;
}

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function dayKindOf(airDate: string, isSpecial: boolean): DayKind {
  const [y, m, d] = airDate.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (isSpecial || dow === 6) return 'special';
  return dow === 0 ? 'sunday-lineup' : 'weekday';
}
export const dayKindLabel = (k: DayKind): string => k === 'special' ? 'SPECIAL BROADCAST' : k === 'sunday-lineup' ? 'SUNDAY REGULAR LINE-UP' : 'REGULAR SHOW';
export const dowName = (airDate: string): string => { const [y, m, d] = airDate.split('-').map(Number); return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]; };

/** Newest day first, then show order as given by `showOrder`. */
export function groupShowDays(entries: readonly RadioEntry[], showOrder: readonly string[] = ['alex-jones', 'war-room', 'sunday-night-live']): ShowDay[] {
  const days = new Map<string, ShowDay>();
  for (const e of entries) {
    const c = e.classified;
    if (!e.airDate || !c.showSlug || e.needsReview) continue;
    const key = `${e.airDate}|${c.showSlug}`;
    const isSpecial = (c.variant ?? '').toLowerCase() === 'special';
    let day = days.get(key);
    if (!day) {
      day = { key, showSlug: c.showSlug, showName: c.cleanTitle.split(' — ')[0].replace(/ Special$/, ''), airDate: e.airDate, dayKind: dayKindOf(e.airDate, isSpecial), full: null, special: null, parts: [] };
      days.set(key, day);
    }
    if (isSpecial) day.special = e;
    else if (e.hourNumber !== null) day.parts.push({ hour: e.hourNumber, entryId: e.id, audioUrl: e.audioUrl, videoUrl: e.videoUrl });
    else day.full = e;
  }
  const rank = (s: string) => { const i = showOrder.indexOf(s); return i < 0 ? showOrder.length : i; };
  const out = [...days.values()];
  for (const d of out) d.parts.sort((a, b) => a.hour - b.hour);
  return out.sort((a, b) => (a.airDate === b.airDate ? rank(a.showSlug) - rank(b.showSlug) : a.airDate < b.airDate ? 1 : -1));
}

const partTitle = (day: ShowDay, hour: number, total: number): string => `${day.showName} — Hour ${hour} of ${total} — ${formatAirDate(day.airDate)}`;

/** The ordered parts a Full Show would play, in `mode`. */
export function planFullShow(day: ShowDay, mode: FullShowMode): FullShowPlan {
  if (day.special) {
    const e = day.special;
    if (mode === 'video' && !e.videoUrl) return { mode, items: [], missingHours: [], singleFile: true, playable: false, reason: 'No video file is published for this special.' };
    return { mode, singleFile: true, playable: true, missingHours: [], items: [{ src: mode === 'video' ? e.videoUrl! : e.audioUrl, mediaType: mode, programId: mode === 'video' ? `${e.id}:video` : e.id, title: e.title, partNo: 1, totalParts: 1 }] };
  }
  if (mode === 'audio' && day.full) {
    const e = day.full;
    return { mode, singleFile: true, playable: true, missingHours: [], items: [{ src: e.audioUrl, mediaType: 'audio', programId: e.id, title: e.title, partNo: 1, totalParts: 1 }] };
  }
  const highest = day.parts.reduce((m, p) => Math.max(m, p.hour), 0);
  const have = (p: ShowPart) => (mode === 'video' ? p.videoUrl : p.audioUrl);
  const playableParts = day.parts.filter((p) => have(p));
  const present = new Set(playableParts.map((p) => p.hour));
  const missingHours: number[] = [];
  for (let h = 1; h <= highest; h++) if (!present.has(h)) missingHours.push(h);
  if (playableParts.length === 0) {
    return { mode, items: [], missingHours, singleFile: false, playable: false, reason: mode === 'video' ? 'No video hours are published for this show yet.' : 'No audio is published for this show yet.' };
  }
  const total = highest;
  return {
    mode, singleFile: false, playable: true, missingHours,
    items: playableParts.map((p, i) => ({
      src: have(p)!, mediaType: mode, programId: mode === 'video' ? `${p.entryId}:video` : p.entryId,
      title: partTitle(day, p.hour, total), partNo: i + 1, totalParts: playableParts.length,
    })),
  };
}
