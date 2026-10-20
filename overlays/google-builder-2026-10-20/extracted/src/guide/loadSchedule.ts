/* One shared way for the Home page to read a guide's schedule: the Guide's own cache first, one request at a time per guide,
 * and the viewer's timezone offset (the server windows looped music channels around the viewer's local hour). */
import type { ScheduleChannel } from '../types';
import { clearScheduleCache, getCachedLightSchedule, getCachedSchedule, isStale, setCachedLightSchedule, setCachedSchedule } from './scheduleCache';

const inflight = new Map<string, Promise<ScheduleChannel[]>>();

export function loadSchedule(guideId: string, fetchImpl: typeof fetch = fetch): Promise<ScheduleChannel[]> {
  const cached = guideId === 'audio-podcasts'
    ? getCachedLightSchedule(guideId) ?? getCachedSchedule(guideId)
    : getCachedSchedule(guideId);
  // A cached guide older than STALE_AFTER_MS is refetched (the Guide and Today views already do this); if the refetch fails the old copy is still returned rather than nothing.
  if (cached && !isStale(cached)) return Promise.resolve(cached.channels);
  const running = inflight.get(guideId);
  if (running) return running;
  const p = (async () => {
    const lightQuery = guideId === 'audio-podcasts' ? '&light=1' : '';
    const res = await fetchImpl(`/api/schedule?guide=${encodeURIComponent(guideId)}&tz=${new Date().getTimezoneOffset()}${lightQuery}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data?.channels) || data.channels.length === 0) throw new Error('no channels');
    if (guideId === 'audio-podcasts' && data.light === true) setCachedLightSchedule(guideId, data.channels);
    else {
      if (guideId === 'audio-podcasts') clearScheduleCache(guideId);
      setCachedSchedule(guideId, data.channels);
    }
    return data.channels as ScheduleChannel[];
  })().catch((e) => { if (cached && guideId !== 'audio-podcasts') return cached.channels; throw e; }).finally(() => { inflight.delete(guideId); });
  inflight.set(guideId, p);
  return p;
}
