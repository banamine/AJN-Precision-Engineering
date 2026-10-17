import type { ScheduleChannel } from "../types";

export interface ScheduleCacheEntry {
  channels: ScheduleChannel[];
  fetchedAt: number;
}

export const STALE_AFTER_MS = 10 * 60 * 1000;

const schedules = new Map<string, ScheduleCacheEntry>();

export function getCachedSchedule(guideId: string): ScheduleCacheEntry | undefined {
  return schedules.get(guideId);
}

export function setCachedSchedule(guideId: string, channels: unknown, now = Date.now()): void {
  if (!Array.isArray(channels) || channels.length === 0) return;
  schedules.set(guideId, { channels: channels as ScheduleChannel[], fetchedAt: now });
}

export function isStale(entry: ScheduleCacheEntry, now = Date.now()): boolean {
  return now - entry.fetchedAt >= STALE_AFTER_MS;
}

export function clearScheduleCache(guideId?: string): void {
  if (guideId === undefined) schedules.clear();
  else schedules.delete(guideId);
}
