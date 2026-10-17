// "Next 48 hours of Classic TV" for the Home page, as a small slice (never the 20+ MB Classic schedule).
// Times: Classic programs sit on the VIEWER'S LOCAL clock (startHour/endHour = hours since local midnight; hours >= 24 are
// tomorrow). startTimeUtc is a back-to-back layout from 00:00 UTC and is NOT used. The client sends ?tz=<Date#getTimezoneOffset()>.
// Failure policy: when the schedule is not ready or fails, serve the last good copy marked stale (max 6 h old);
// with none, answer pending with an empty list. Never an empty list presented as success.
import type { Program, ScheduleChannel } from '../src/types';
import { dailyOrder } from '../src/utils/dayRotation';
import { localHourAt } from './scheduleWindow';

export const WINDOW_HOURS = 48;
export const MAX_CHANNELS = 16;
export const TODAY_PER_CHANNEL = 3;
export const TOMORROW_PER_CHANNEL = 2;
export const PER_CHANNEL = TODAY_PER_CHANNEL + TOMORROW_PER_CHANNEL;
export const MAX_STALE_MS = 6 * 3600_000;
export const MAX_PAYLOAD_BYTES = 60_000;
const HOUR_MS = 3600_000;

export interface UpcomingProgram { programId: string; assetId?: string; sourceId?: string; title: string; startMs: number; endMs: number; path: string; mediaType: 'video' | 'audio' }
export interface UpcomingChannel { id: string; name: string; logo?: string; programs: UpcomingProgram[] }
export interface UpcomingBody { guideId: 'classic-tv'; generatedAt: string | null; windowStartMs: number; windowEndMs: number; stale: boolean; pending: boolean; channels: UpcomingChannel[] }

const pathOf = (p: Program) => String(p.archivePath || p.mediaUrl || '');
const hoursOf = (p: Program) => ({ s: p.startHour ?? p.startTime ?? 0, e: p.endHour ?? p.endTime ?? 24 });
const isUtcListing = (p: Program) => (p.metadata as Record<string, unknown> | undefined)?.epg === 'utc';

/** The viewer's calendar date (YYYY-MM-DD) for rotation: shifts the instant by the viewer's offset and reads UTC fields. */
export function viewerDateKey(nowMs: number, tzMinutes: number): string {
  const d = new Date(nowMs - tzMinutes * 60_000);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}

export function buildClassicUpcoming(channels: readonly ScheduleChannel[], nowMs: number, tzMinutes: number): UpcomingChannel[] {
  const lh = localHourAt(nowMs, String(tzMinutes));
  if (lh === null) throw new RangeError('invalid tz');
  const midnight = nowMs - lh * HOUR_MS;
  const from = lh, to = lh + WINDOW_HOURS;
  const rows: UpcomingChannel[] = [];
  for (const c of channels) {
    const progs = (c.programs ?? [])
      .filter((p) => !isUtcListing(p) && pathOf(p) !== '')
      .map((p) => ({ p, ...hoursOf(p) }))
      .filter(({ s, e }) => e > from && s < to && e > s)
      .sort((a, b) => a.s - b.s);
    // Keep a few from today AND a few from tomorrow, or the Tomorrow tab would always be empty (a day has many short items).
    const keep = [...progs.filter(({ s }) => s < 24).slice(0, TODAY_PER_CHANNEL), ...progs.filter(({ s }) => s >= 24).slice(0, TOMORROW_PER_CHANNEL)];
    const shaped = keep
      .map(({ p, s, e }): UpcomingProgram => ({
        programId: p.id, assetId: p.assetId ?? (p.metadata?.assetId as string | undefined), sourceId: p.sourceId ?? (p.metadata?.sourceId as string | undefined),
        title: p.title, startMs: Math.round(midnight + s * HOUR_MS), endMs: Math.round(midnight + e * HOUR_MS),
        path: pathOf(p), mediaType: p.mediaType === 'audio' ? 'audio' : 'video',
      }));
    if (shaped.length) rows.push({ id: c.id, name: c.name, ...(typeof c.logo === 'string' && c.logo.startsWith('/') ? { logo: c.logo } : {}), programs: shaped });
  }
  // Deterministic per viewer-day pick so Home does not reshuffle on every request.
  return dailyOrder(rows, (r) => r.id, viewerDateKey(nowMs, tzMinutes), 'classic48').slice(0, MAX_CHANNELS);
}

export interface UpcomingDeps {
  /** Resolves the Classic TV channels, or null when the schedule is not ready yet. May reject. */
  getChannels: () => Promise<readonly ScheduleChannel[] | null>;
  now: () => number;
}
export interface UpcomingReply { status: number; body: UpcomingBody | { error: string } }

export function createClassicUpcoming(deps: UpcomingDeps) {
  let last: { channels: readonly ScheduleChannel[]; at: number } | null = null;
  return {
    async handle(tzRaw: unknown): Promise<UpcomingReply> {
      const nowMs = deps.now();
      const tz = typeof tzRaw === 'string' && /^-?\d+$/.test(tzRaw) ? Number(tzRaw) : NaN;
      if (localHourAt(nowMs, tzRaw) === null || !Number.isFinite(tz)) return { status: 400, body: { error: 'tz must be Date#getTimezoneOffset() in minutes' } };
      const head = { guideId: 'classic-tv' as const, windowStartMs: nowMs, windowEndMs: nowMs + WINDOW_HOURS * HOUR_MS };
      let fresh: readonly ScheduleChannel[] | null = null;
      try { fresh = await deps.getChannels(); } catch { fresh = null; }
      if (fresh && fresh.length > 0) {
        last = { channels: fresh, at: nowMs };
        const channels = buildClassicUpcoming(fresh, nowMs, tz);
        return { status: 200, body: { ...head, generatedAt: new Date(nowMs).toISOString(), stale: false, pending: false, channels } };
      }
      if (last && nowMs - last.at <= MAX_STALE_MS) {
        const channels = buildClassicUpcoming(last.channels, nowMs, tz);
        return { status: 200, body: { ...head, generatedAt: new Date(last.at).toISOString(), stale: true, pending: false, channels } };
      }
      return { status: 200, body: { ...head, generatedAt: null, stale: false, pending: true, channels: [] } };
    },
  };
}
