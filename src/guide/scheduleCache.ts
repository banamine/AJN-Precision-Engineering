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

/** Sparse guide caches are separate so Home/export consumers never mistake them for full schedules. */
export function getCachedLightSchedule(guideId: string): ScheduleCacheEntry | undefined {
  return lightSchedules.get(guideId);
}

export function setCachedLightSchedule(guideId: string, channels: unknown, now = Date.now()): void {
  if (!Array.isArray(channels) || channels.length === 0) return;
  lightSchedules.set(guideId, { channels: channels as ScheduleChannel[], fetchedAt: now });
}

export function isValidAudioLightSchedule(channels: ScheduleChannel[]): boolean {
  const partial = channels.filter((channel) => channel.programsComplete === false);
  return partial.length > 0 && partial.every((channel) =>
    channel.id.startsWith('item-music-') && Number.isInteger(channel.programCount) &&
    (channel.programCount ?? 0) > 24 && channel.programs.length === 3);
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

export function shouldDisplayCachedSchedule(guideId: string, entry?: ScheduleCacheEntry, now = Date.now()): boolean {
  return Boolean(entry && (guideId !== 'audio-podcasts' || !isStale(entry, now)));
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
