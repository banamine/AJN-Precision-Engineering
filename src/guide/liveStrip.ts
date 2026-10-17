/* Pure logic for the Live page category strip: which channels exist per category and which are on air right now.
 * No React, no network. Uses the Guide's own helpers (categoryOf, sortChannelsAlpha, findLiveProgram). */
import type { Program, ScheduleChannel } from '../types';
import { categoryOf, sortChannelsAlpha } from './channelIndex';
import { findLiveProgram } from './liveTune';

export const LIVE_ALL = 'all';
export interface LiveStripRow { key: string; guideId: string; channel: ScheduleChannel; categoryId: string; onAir: boolean; program: Program | null; sHour: number; eHour: number }
export interface LiveStripCategory { id: string; label: string; count: number; onAir: number }
export interface GuideChannels { guideId: string; channels: readonly ScheduleChannel[] }

/** Every channel of every given guide, tagged on-air or not at `nowHour`. Keys include the guide id, so equal channel ids in two guides never collide. */
export function buildLiveRows(guides: readonly GuideChannels[], nowHour: number, nowMs: number = Date.now()): LiveStripRow[] {
  const rows: LiveStripRow[] = [];
  for (const g of guides) {
    for (const channel of g.channels) {
      const live = findLiveProgram(channel, nowHour, nowMs);
      rows.push({ key: `${g.guideId}:${channel.id}`, guideId: g.guideId, channel, categoryId: categoryOf(channel).id, onAir: !!live, program: live?.program ?? null, sHour: live?.sHour ?? 0, eHour: live?.eHour ?? 0 });
    }
  }
  return rows;
}

/** Categories present, biggest first (ties alphabetical). */
export function liveCategories(rows: readonly LiveStripRow[]): LiveStripCategory[] {
  const m = new Map<string, LiveStripCategory>();
  for (const r of rows) {
    const e = m.get(r.categoryId);
    if (e) { e.count++; if (r.onAir) e.onAir++; } else m.set(r.categoryId, { id: r.categoryId, label: categoryOf(r.channel).label, count: 1, onAir: r.onAir ? 1 : 0 });
  }
  return [...m.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Rows of one category (or all), on-air channels first, then alphabetical; at most `limit`. `total` is the full match count. */
export function rowsForCategory(rows: readonly LiveStripRow[], category: string, limit: number): { shown: LiveStripRow[]; total: number } {
  const match = rows.filter((r) => category === LIVE_ALL || r.categoryId === category);
  const order = new Map(sortChannelsAlpha(match.map((r) => r.channel)).map((c, i) => [c, i]));
  const sorted = [...match].sort((a, b) => Number(b.onAir) - Number(a.onAir) || (order.get(a.channel) ?? 0) - (order.get(b.channel) ?? 0));
  return { shown: sorted.slice(0, limit), total: match.length };
}
