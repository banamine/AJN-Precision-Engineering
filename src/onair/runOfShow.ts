/* On Air run of show, built from the REAL daily edition (src/utils/dailyEdition.ts).
 * Same segment shape the engine (engine.js) expects: podcast, then a music block, then the next podcast, and so on.
 * Pure: no React, no network, no wall clock. Real durations only: the edition already refuses episodes whose length is unknown. */
import type { Edition, EditionSlot } from '../utils/dailyEdition';
import type { FillerPool } from '../../server/onairFiller';
import { DEFAULT_BACKFILL, planDay, type BackfillCfg, type PlanItem } from './backfill';

export type MusicSource = 'Live 109' | 'Library';
export interface OnAirParams {
  prebufferSec: number; watchdogSec: number; musicInSec: number; musicBedPct: number; bedFadeInSec: number; riseSec: number;
  podcastFadeOutSec: number; musicMinSec: number; musicTargetSec: number; musicMaxSec: number; musicFadeOutSec: number;
  ceilingPodcast: number; ceilingLive109: number; ceilingLibrary: number; nearEndSkipSec: number; panelDwellSec: number;
  headlineMaxAgeHours: number; tickMs: number; standbyLoadSec: number; libraryLoadSec: number; podcastRetries: number; retryWaitSec: number;
  horizonHours: number; musicSource: MusicSource;
  /** Build 15: shape of the early music bed ramp ('ease-in' = starts very quiet and slowly rises; 'linear') and the level the next podcast starts at when music hands over to it (%). */
  bedCurve?: 'ease-in' | 'linear'; podcastInStartPct?: number;
}
/** The locked defaults from the approved mock-up. */
export const DEFAULT_PARAMS: OnAirParams = {
  prebufferSec: 60, watchdogSec: 15, musicInSec: 20, musicBedPct: 25, bedFadeInSec: 12, riseSec: 8, podcastFadeOutSec: 8,
  musicMinSec: 330, musicTargetSec: 420, musicMaxSec: 570, musicFadeOutSec: 10,
  ceilingPodcast: 1.0, ceilingLive109: 0.72, ceilingLibrary: 0.85, nearEndSkipSec: 15, panelDwellSec: 45, headlineMaxAgeHours: 12,
  tickMs: 100, standbyLoadSec: 6, libraryLoadSec: 2, podcastRetries: 3, retryWaitSec: 5, horizonHours: 24, musicSource: 'Live 109',
  bedCurve: 'ease-in', podcastInStartPct: 3,
};

/** Live 109 stations the music blocks alternate between. "Classic Hits 109" is the station's flagship stream (The Original). */
/** The station's own logo from the app's radio directory (Classic Hits 109 entry). Used only when the song feed gives no album art. */
export const STATION_LOGO = 'https://cdn-profiles.tunein.com/s297004/images/logog.png';

export const LIVE_STATIONS: Record<string, { id: string; url: string }> = {
  'Classic Rock 109': { id: 'radio:ch109-classic-rock-109', url: 'https://broadcast.classichits109.com/cr109' },
  'Classic Hits 109': { id: 'radio:ch109-original', url: 'https://broadcast.classichits109.com/70s' },
};
const STATION_ORDER = ['Classic Rock 109', 'Classic Hits 109'];

export interface Segment {
  id: string; index: number; type: 'podcast' | 'music'; name: string; showName: string; episodeTitle: string | null; networkTag: string;
  publishedDate: string; editionTag: string; musicStation: string | null; musicSource: MusicSource | null;
  startMs: number; endMs: number; plannedStartMs: number; plannedEndMs: number; origPlannedStartMs: number; origPlannedEndMs: number;
  actualStartMs: number | null; actualEndMs: number | null; driftMs: number; durationMs: number;
  /** Podcast only: the real episode. */
  src?: string; programId?: string; guid?: string; channelId?: string; showId?: string; artUrl?: string;
  /** Backfill (no fresh podcast): true for news clips, long channel pieces and The Quash. */
  filler?: boolean; tag?: string; why?: string; clipDate?: string | null;
  /** Seconds into the file where this piece starts (a news clip window, or a seeded start in a long file). */
  startOffsetSec?: number;
}

const networkTagFor = (showId: string): string => (showId === 'bannon-war-room' ? "REAL AMERICA'S VOICE" : '');
const dateLabel = (ms: number | null): string => {
  if (ms === null) return '';
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  return p; // YYYY-MM-DD
};

/** One podcast segment per edition slot, one music block after each, chained from `startMs` until `horizonMs`.
 *  The edition's loop + replay tail repeats if the horizon is longer than one pass. Returns [] when the edition has no slots. */
export function buildRunOfShowFromEdition(edition: Edition | null, params: OnAirParams, startMs: number, horizonMs: number, firstSeq = 1, pool: FillerPool | null = null, cfg: BackfillCfg = DEFAULT_BACKFILL, dateKey = ''): Segment[] {
  // With a backfill pool the day is planned from TODAY'S fresh podcasts only (the edition loop; older episodes never play) plus real filler clips.
  if (pool && pool.news.length + pool.long.length + pool.quash.length > 0) {
    const key = edition?.dateKey ?? dateKey;
    const plan = planDay({ fresh: edition ? edition.loop : [], pool, dateKey: key, cfg: { ...cfg, musicSec: params.musicTargetSec }, targetSec: Math.max(0, (horizonMs - startMs) / 1000) });
    return buildRunOfShowFromPlan(plan, params, startMs, horizonMs, firstSeq);
  }
  const slots: EditionSlot[] = edition ? [...edition.loop, ...edition.tail] : [];
  if (slots.length === 0) return [];
  const out: Segment[] = [];
  const musicMs = params.musicTargetSec * 1000;
  let cursor = startMs, musicIdx = 0, seq = firstSeq, i = 0, guard = 0;
  const push = (s: Omit<Segment, 'index' | 'plannedStartMs' | 'plannedEndMs' | 'origPlannedStartMs' | 'origPlannedEndMs' | 'actualStartMs' | 'actualEndMs' | 'driftMs'>) =>
    out.push({ ...s, index: out.length + 1, plannedStartMs: s.startMs, plannedEndMs: s.endMs, origPlannedStartMs: s.startMs, origPlannedEndMs: s.endMs, actualStartMs: null, actualEndMs: null, driftMs: 0 });
  while (cursor < horizonMs && guard++ < 4000) {
    const slot = slots[i % slots.length]; i += 1;
    const dur = Math.round(slot.durationSeconds * 1000);
    if (!(dur > 0)) continue;
    push({
      id: `seg-pod-${slot.showId}-${seq}`, type: 'podcast', name: tidyShowName(slot.showName), showName: tidyShowName(slot.showName), episodeTitle: slot.title,
      networkTag: networkTagFor(slot.showId), publishedDate: dateLabel(slot.publishedMs), editionTag: slot.label ? slot.label.toUpperCase() : 'TODAY',
      musicStation: null, musicSource: null, startMs: cursor, endMs: cursor + dur, durationMs: dur,
      src: slot.src, programId: slot.programId, guid: slot.guid, channelId: slot.channelId, showId: slot.showId, ...(slot.artUrl ? { artUrl: slot.artUrl } : {}),
    });
    seq += 1; cursor += dur;
    if (cursor >= horizonMs) break;
    const station = STATION_ORDER[musicIdx % 2];
    push({
      id: `seg-mus-${firstSeq}-${musicIdx + 1}`, type: 'music', name: params.musicSource === 'Library' ? `Music Block ${musicIdx + 1} (Library)` : `Music Block ${musicIdx + 1} (${station})`,
      showName: station, episodeTitle: null, networkTag: params.musicSource === 'Library' ? 'LIBRARY' : 'LIVE 109', publishedDate: dateLabel(cursor),
      editionTag: slot.label ? slot.label.toUpperCase() : 'TODAY', musicStation: station, musicSource: params.musicSource,
      startMs: cursor, endMs: cursor + musicMs, durationMs: musicMs,
    });
    musicIdx += 1; cursor += musicMs;
  }
  return out;
}

/** Segments from a backfill plan: every spoken block is a 'podcast'-type segment for the engine (one foreground source, music after it). */
export function buildRunOfShowFromPlan(plan: readonly PlanItem[], params: OnAirParams, startMs: number, horizonMs: number, firstSeq = 1): Segment[] {
  const out: Segment[] = [];
  const musicMs = params.musicTargetSec * 1000;
  let cursor = startMs, musicIdx = 0, seq = firstSeq;
  const push = (s: Omit<Segment, 'index' | 'plannedStartMs' | 'plannedEndMs' | 'origPlannedStartMs' | 'origPlannedEndMs' | 'actualStartMs' | 'actualEndMs' | 'driftMs'>) =>
    out.push({ ...s, index: out.length + 1, plannedStartMs: s.startMs, plannedEndMs: s.endMs, origPlannedStartMs: s.startMs, origPlannedEndMs: s.endMs, actualStartMs: null, actualEndMs: null, driftMs: 0 });
  for (const it of plan) {
    if (cursor >= horizonMs) break;
    const dur = Math.round(it.durationSec * 1000);
    if (!(dur > 0)) continue;
    if (it.slot) {
      const slot = it.slot;
      push({
        id: `seg-pod-${slot.showId}-${seq}`, type: 'podcast', name: tidyShowName(slot.showName), showName: tidyShowName(slot.showName), episodeTitle: slot.title,
        networkTag: networkTagFor(slot.showId), publishedDate: dateLabel(slot.publishedMs), editionTag: it.tag, musicStation: null, musicSource: null,
        startMs: cursor, endMs: cursor + dur, durationMs: dur, src: slot.src, programId: slot.programId, guid: slot.guid, channelId: slot.channelId, showId: slot.showId,
        ...(slot.artUrl ? { artUrl: slot.artUrl } : {}), why: it.why, filler: false,
      });
    } else if (it.clip) {
      const c = it.clip;
      push({
        id: `seg-fil-${it.role}-${seq}`, type: 'podcast', name: it.channel, showName: it.channel, episodeTitle: c.title, networkTag: '', publishedDate: it.clipDate ?? '', editionTag: it.tag,
        musicStation: null, musicSource: null, startMs: cursor, endMs: cursor + dur, durationMs: dur, src: c.src, programId: `fill-${c.showId}-${seq}`, guid: `${c.src}#${c.startSec}`,
        channelId: c.channelId, showId: c.showId, filler: true, tag: it.tag, why: it.why, clipDate: it.clipDate, startOffsetSec: it.startOffsetSec,
      });
    } else continue;
    seq += 1; cursor += dur;
    if (!it.musicAfter || cursor >= horizonMs) continue;
    const station = STATION_ORDER[musicIdx % 2];
    push({
      id: `seg-mus-${firstSeq}-${musicIdx + 1}`, type: 'music', name: params.musicSource === 'Library' ? `Music Block ${musicIdx + 1} (Library)` : `Music Block ${musicIdx + 1} (${station})`,
      showName: station, episodeTitle: null, networkTag: params.musicSource === 'Library' ? 'LIBRARY' : 'LIVE 109', publishedDate: dateLabel(cursor),
      editionTag: it.tag, musicStation: station, musicSource: params.musicSource, startMs: cursor, endMs: cursor + musicMs, durationMs: musicMs,
    });
    musicIdx += 1; cursor += musicMs;
  }
  return out;
}

/** Index of the segment on air at `nowMs` (clamped to the first or last segment). */
/** The feed titles some shows "Name (podcast)"; on screen the suffix is noise. */
export function tidyShowName(n: string): string { return n.replace(/\s*\(podcast\)\s*$/i, '').trim() || n; }

export function segmentIndexAt(ros: Segment[], nowMs: number): number {
  for (let i = 0; i < ros.length; i++) if (nowMs >= ros[i].startMs && nowMs < ros[i].endMs) return i;
  return nowMs < (ros[0]?.startMs ?? 0) ? 0 : Math.max(0, ros.length - 1);
}
