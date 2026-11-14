import bakedClassic from '../src/data/classicNetworkPublication.json';
import bakedMovies from '../src/data/classicMoviesPublication.json';
import bakedWesterns from '../src/data/classicWesternsPublication.json';
import type { ScheduleChannel, Program } from '../src/types';
import { publicationHash, assertRepeat, HOUR, type Publication } from './classicNetwork';

export function validatePublication(value: unknown): Publication {
  if (!value || typeof value !== 'object') throw new Error('Publication artifact missing');
  const p = value as Publication;
  if (p.schema !== 1 || !Array.isArray(p.programs) || !p.programs.length || p.revision !== publicationHash(p)) throw new Error('Invalid publication schema/hash');
  if (!Number.isFinite(Date.parse(p.activeFrom)) || !Number.isFinite(p.coveredUntilUtcMs) || p.repeatGapHours !== 168) throw new Error('Invalid publication coverage');
  const ids = new Set<string>();
  const starts: Array<{ episodeKey: string; start: number }> = [];
  let end: number | undefined;
  for (const row of p.programs) {
    const s = Date.parse(row.startTimeUtc!), e = Date.parse(row.endTimeUtc!);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s || (end !== undefined && s !== end)) throw new Error('Publication gap/overlap/invalid interval');
    if (row.metadata?.epg !== 'utc' || row.metadata?.scheduledVod !== true || row.channelId !== p.networkId ||
      row.metadata?.occurrenceId !== row.id || !row.metadata?.episodeKey || ids.has(row.id) ||
      !String(row.id).startsWith(`cn1:${p.networkId}:`) || !row.archivePath?.startsWith('/download/')) throw new Error('Invalid occurrence identity/tags/path');
    if (Math.abs((e - s) - Number(row.metadata.durationSeconds) * 1000) > 1) throw new Error('Invalid occurrence runtime');
    ids.add(row.id); starts.push({ episodeKey: String(row.metadata.episodeKey), start: s }); end = e;
  }
  assertRepeat(starts, 168 * HOUR);
  if (end !== p.coveredUntilUtcMs || p.checkpoint.nextUncompiledInstant !== end) throw new Error('Invalid coverage end');
  return p;
}
export function createPublicationReader(value: unknown) {
  let publication: Publication | undefined, error: string | undefined;
  try { publication = validatePublication(value); } catch (e) { error = e instanceof Error ? e.message : String(e); }
  return {
    getWindow(nowMs: number, aheadMs = 48 * HOUR, behindMs = 0): { programs: Program[]; error?: string } {
      if (!publication) return { programs: [], error: error ?? 'Publication unavailable' };
      const firstStart = publication.programs[0].startTimeUtc!;
      if (nowMs < Date.parse(firstStart)) return { programs: [], error: `Schedule starts ${firstStart}. Operator action needed if this is unexpected.` };
      if (nowMs >= publication.coveredUntilUtcMs) return { programs: [], error: `Schedule ends ${new Date(publication.coveredUntilUtcMs).toISOString()}. Operator action needed` };
      return { programs: publication.programs.filter(p => Date.parse(p.endTimeUtc!) > nowMs - behindMs && Date.parse(p.startTimeUtc!) < nowMs + aheadMs) };
    },
  };
}
const classic = createPublicationReader(bakedClassic);
const movies = createPublicationReader(bakedMovies);
const westerns = createPublicationReader(bakedWesterns);
function networkChannel(reader: ReturnType<typeof createPublicationReader>, id: string, name: string, guideId: string, group: string, nowMs: number): ScheduleChannel {
  // Include the previous 24 h so the guide grid shows today's earlier blocks (other rows show a full day); ahead stays 48 h.
  const window = reader.getWindow(nowMs, 48 * HOUR, 24 * HOUR);
  return { id, name, guideId, group,
    mediaType: 'video', programs: window.programs, sourceStatus: window.error ? 'unavailable' : 'ok', ...(window.error ? { sourceError: window.error } : {}) };
}
export function classicNetworkChannel(nowMs = Date.now()): ScheduleChannel {
  return networkChannel(classic, 'classic-network', 'AJN Classic TV', 'classic-tv', 'Classic TV', nowMs);
}
export function classicWesternsChannel(nowMs = Date.now()): ScheduleChannel {
  return networkChannel(westerns, 'classic-westerns', 'AJN Westerns', 'classic-tv', 'Classic TV', nowMs);
}
export function classicMoviesChannel(nowMs = Date.now()): ScheduleChannel {
  return networkChannel(movies, 'classic-movies', 'AJN Classic Movies', 'movies-classics-vault', 'Movies', nowMs);
}
