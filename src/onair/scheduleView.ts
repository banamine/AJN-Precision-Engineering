/* Pure schedule views for the On Air panels. No React, no wall clock: callers pass `nowMs`.
 * Boundary rule: a show whose scheduled start is at or before `nowMs` is no longer "still to come". */
import type { Segment } from './runOfShow';
import { daypartForHour } from './dayparts';

const DENVER_HOUR = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: '2-digit', hourCycle: 'h23' });
const DENVER_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' });
const DENVER_HM = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Denver', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const denverHour = (ms: number): number => Number(DENVER_HOUR.format(new Date(ms)));
export const denverDay = (ms: number): string => DENVER_DAY.format(new Date(ms));
export const hmLabel = (ms: number): string => DENVER_HM.format(new Date(ms));

export interface ShowRow { key: string; name: string; startMs: number; label: string }
const spoken = (s: Segment): boolean => s.type === 'podcast';
const rowOf = (s: Segment, driftMs: number): ShowRow => ({ key: s.id, name: s.name, startMs: s.startMs + driftMs, label: `${hmLabel(s.startMs + driftMs)}  ${s.name}` });

/** Spoken shows after `nowMs`, in time order, one row per show name in a row (a show split into several blocks counts once). */
export function upcomingShows(list: readonly Segment[], nowMs: number, driftMs = 0): ShowRow[] {
  const out: ShowRow[] = []; let prev = '';
  for (const s of list) {
    if (!spoken(s) || s.startMs + driftMs <= nowMs) continue;
    if (s.name === prev) continue;
    prev = s.name; out.push(rowOf(s, driftMs));
  }
  return out;
}
/** "Still to come today": upcoming shows that start on today's Denver date, each show name once. */
export function stillToComeToday(list: readonly Segment[], nowMs: number, limit = 4, driftMs = 0): string[] {
  const today = denverDay(nowMs); const seen = new Set<string>(); const out: string[] = [];
  for (const r of upcomingShows(list, nowMs, driftMs)) {
    if (denverDay(r.startMs) !== today || seen.has(r.name)) continue;
    seen.add(r.name); out.push(r.label);
    if (out.length >= limit) break;
  }
  return out;
}
/** Next three shows after the current one: the always-visible "Coming up". */
export function comingUp(list: readonly Segment[], nowMs: number, curName: string, driftMs = 0): ShowRow[] {
  return upcomingShows(list, nowMs, driftMs).filter((r, i) => !(i === 0 && r.name === curName)).slice(0, 3);
}
/** The rest of the current daypart after the "Coming up" three: the cycling bottom-row panels. */
export function daypartRest(list: readonly Segment[], nowMs: number, curName: string, driftMs = 0): ShowRow[] {
  const dp = daypartForHour(denverHour(nowMs)); const today = denverDay(nowMs);
  const skip = new Set(comingUp(list, nowMs, curName, driftMs).map((r) => r.key));
  const seen = new Set<string>();
  return upcomingShows(list, nowMs, driftMs).filter((r) => {
    if (skip.has(r.key) || r.name === curName || seen.has(r.name)) return false;
    if (denverDay(r.startMs) !== today || daypartForHour(denverHour(r.startMs)) !== dp) return false;
    seen.add(r.name); return true;
  });
}
/** Snap-in index for `count` panels that show consecutive entries and advance together every `periodMs`. */
export function cycleStart(nowMs: number, len: number, count: number, periodMs = 8000): number {
  if (len <= 0) return 0;
  const pages = Math.max(1, Math.ceil(len / count));
  return (Math.floor(nowMs / periodMs) % pages) * count;
}
/** A countdown never goes negative: at zero it says so. */
export function remainingLabel(remSec: number, fmt: (s: number) => string): string { return remSec > 0.5 ? fmt(remSec) : 'Finishing'; }
