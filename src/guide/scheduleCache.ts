import type { ScheduleChannel } from "../types";

export interface ScheduleCacheEntry {
  channels: ScheduleChannel[];
  fetchedAt: number;
}

export const STALE_AFTER_MS = 10 * 60 * 1000;

const schedules = new Map<string, ScheduleCacheEntry>();
const lightSchedules = new Map<string, ScheduleCacheEntry>();
const fullChannelRows = new Map<string, Map<string, ScheduleChannel>>();

export function getCachedSchedule(guideId: string): ScheduleCacheEntry | undefined {
  return schedules.get(guideId);
}

export function setCachedSchedule(guideId: string, channels: unknown, now = Date.now()): void {
  if (!Array.isArray(channels) || channels.length === 0) return;
  schedules.set(guideId, { channels: channels as ScheduleChannel[], fetchedAt: now });
}

/** Classic TV's light guide cache is separate so Home/export consumers never mistake it for a full schedule. */
export function getCachedLightSchedule(guideId: string): ScheduleCacheEntry | undefined {
  return lightSchedules.get(guideId);
}

export function setCachedLightSchedule(guideId: string, channels: unknown, now = Date.now()): void {
  if (!Array.isArray(channels) || channels.length === 0) return;
  lightSchedules.set(guideId, { channels: channels as ScheduleChannel[], fetchedAt: now });
}

export function getCachedChannelRows(guideId: string, channelId: string): ScheduleChannel | undefined {
  return fullChannelRows.get(guideId)?.get(channelId);
}

export function setCachedChannelRows(guideId: string, channel: ScheduleChannel): void {
  let byId = fullChannelRows.get(guideId);
  if (!byId) {
    byId = new Map<string, ScheduleChannel>();
    fullChannelRows.set(guideId, byId);
  }
  byId.set(channel.id, { ...channel, programsComplete: true });
}

export function isStale(entry: ScheduleCacheEntry, now = Date.now()): boolean {
  return now - entry.fetchedAt >= STALE_AFTER_MS;
}

export function clearScheduleCache(guideId?: string): void {
  if (guideId === undefined) {
    schedules.clear();
    lightSchedules.clear();
    fullChannelRows.clear();
  } else {
    schedules.delete(guideId);
    lightSchedules.delete(guideId);
    fullChannelRows.delete(guideId);
  }
}
