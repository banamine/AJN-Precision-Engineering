/* Pure logic for the Home "Tonight on AJN" wall: which four on-air channels to show and what is next on each.
 * No React, no network, no random values. Progress and "next" come only from the schedule's own start/end hours. */
import type { Program, ScheduleChannel } from '../types';
import { localHours } from '../guide/groupProgramsForGrid';
import type { LiveStripRow } from '../guide/liveStrip';

export const WALL_SIZE = 4;

export interface WallItem { row: LiveStripRow; progress: number; next: { title: string; sHour: number } | null }

/** 0..1 share of the current programme that has elapsed at `nowHour`; 0 when the programme has no usable length. */
export function progressOf(sHour: number, eHour: number, nowHour: number): number {
  const span = eHour - sHour;
  if (!(span > 0)) return 0;
  return Math.min(1, Math.max(0, (nowHour - sHour) / span));
}

/** The programme on `channel` that starts soonest at or after `afterHour` (the current programme's end). */
export function nextProgram(channel: ScheduleChannel, afterHour: number, nowMs?: number): { program: Program; sHour: number } | null {
  let best: { program: Program; sHour: number } | null = null;
  for (const program of channel.programs) {
    const { sHour } = localHours(program, nowMs);
    if (sHour >= afterHour - 1e-6 && sHour < 24 && (!best || sHour < best.sHour)) best = { program, sHour };
  }
  return best;
}

/** First `count` on-air video channels in the guide's own order (video only: the wall shows pictures, audio has its own deck). */
export function pickWall(rows: readonly LiveStripRow[], nowHour: number, count: number = WALL_SIZE, nowMs?: number): WallItem[] {
  const out: WallItem[] = [];
  for (const row of rows) {
    if (out.length >= count) break;
    if (!row.onAir || !row.program) continue;
    if ((row.program.mediaType || row.channel.mediaType) === 'audio') continue;
    const nx = nextProgram(row.channel, row.eHour, nowMs);
    out.push({ row, progress: progressOf(row.sHour, row.eHour, nowHour), next: nx ? { title: nx.program.title, sHour: nx.sHour } : null });
  }
  return out;
}

export const fmtHour = (h: number): string => {
  const total = Math.round(h * 60);
  const hh = Math.floor(total / 60) % 24, mm = total % 60;
  const d = new Date(); d.setHours(hh, mm, 0, 0);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};
