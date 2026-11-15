import bakedClassic from '../src/data/classicNetworkPublication.json';
import bakedMovies from '../src/data/classicMoviesPublication.json';
import bakedWesterns from '../src/data/classicWesternsPublication.json';
import type { ScheduleChannel, Program } from '../src/types';
import { publicationHash, assertRepeat, HOUR, type Publication } from './classicNetwork';
import { GENRE_CHANNELS } from '../src/guide/genreChannelIds';
import genreSitcoms from '../src/data/genre/ajn247-sitcomsPublication.json';
import genreCrime from '../src/data/genre/ajn247-crimePublication.json';
import genreScifi from '../src/data/genre/ajn247-scifiPublication.json';
import genreAction from '../src/data/genre/ajn247-actionPublication.json';
import genreCartoons from '../src/data/genre/ajn247-cartoonsPublication.json';
import genreMoviesActionWestern from '../src/data/genre/ajn247-movies-action-westernPublication.json';
import genreMoviesScifiHorror from '../src/data/genre/ajn247-movies-scifi-horrorPublication.json';
import genreMoviesComedyDramaNoir from '../src/data/genre/ajn247-movies-comedy-drama-noirPublication.json';

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

/* ---- 8 genre 24/7 channels (shuffle-in-order TV, random-movie films). Readers are built lazily and validated on first use;
 * a failed validation yields an explicit unavailable channel (sourceError), never a fallback schedule. ---- */
const genreSources: Record<string, unknown> = {
  'ajn247-sitcoms': genreSitcoms, 'ajn247-crime': genreCrime, 'ajn247-scifi': genreScifi, 'ajn247-action': genreAction, 'ajn247-cartoons': genreCartoons,
  'ajn247-movies-action-western': genreMoviesActionWestern, 'ajn247-movies-scifi-horror': genreMoviesScifiHorror, 'ajn247-movies-comedy-drama-noir': genreMoviesComedyDramaNoir,
};
const genreReaders = new Map<string, ReturnType<typeof createPublicationReader>>();
function genreReader(id: string) {
  let r = genreReaders.get(id);
  if (!r) { r = createPublicationReader(genreSources[id]); genreReaders.set(id, r); }
  return r;
}
function genreChannels(guideId: 'classic-tv' | 'movies-classics-vault', nowMs: number): ScheduleChannel[] {
  return GENRE_CHANNELS.filter(c => c.guideId === guideId).map(c => networkChannel(genreReader(c.id), c.id, c.name, c.guideId, c.group, nowMs));
}
export function genreTvChannels(nowMs = Date.now()): ScheduleChannel[] { return genreChannels('classic-tv', nowMs); }
export function genreMovieChannels(nowMs = Date.now()): ScheduleChannel[] { return genreChannels('movies-classics-vault', nowMs); }
