/* One shared way for the Home page to read a guide's schedule: the Guide's own cache first, one request at a time per guide,
 * and the viewer's timezone offset (the server windows looped music channels around the viewer's local hour). */
import type { ScheduleChannel } from '../types';
import { getCachedSchedule, setCachedSchedule } from './scheduleCache';

const inflight = new Map<string, Promise<ScheduleChannel[]>>();

export function loadSchedule(guideId: string, fetchImpl: typeof fetch = fetch): Promise<ScheduleChannel[]> {
  const cached = getCachedSchedule(guideId);
  if (cached) return Promise.resolve(cached.channels);
  const running = inflight.get(guideId);
  if (running) return running;
  const p = (async () => {
    const res = await fetchImpl(`/api/schedule?guide=${encodeURIComponent(guideId)}&tz=${new Date().getTimezoneOffset()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data?.channels) || data.channels.length === 0) throw new Error('no channels');
    setCachedSchedule(guideId, data.channels);
    return data.channels as ScheduleChannel[];
  })().finally(() => { inflight.delete(guideId); });
  inflight.set(guideId, p);
  return p;
}
