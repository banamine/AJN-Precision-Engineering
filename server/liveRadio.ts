import type { Program, ScheduleChannel } from '../src/types';
import liveRadioSourcesJson from '../src/data/liveRadioSources.json';
// Bulk directory: SERVER-ONLY. Never import this file from src/ (it would be bundled into the browser).
import liveRadioDirectoryJson from './data/liveRadioDirectory.json';
// Vancouver / Lower Mainland additions: SERVER-ONLY, same rules as the bulk directory.
import liveRadioVancouverJson from './data/liveRadioVancouver.json';
import liveRadioClassicHits109Json from './data/liveRadioClassicHits109.json';
import liveRadioNumbersJson from './data/liveRadioNumbers.json';

export interface LiveRadioStation {
  id: string;
  name: string;
  country: 'US' | 'CA';
  region?: string;
  city?: string;
  /** Optional neighbourhood / district (display only). */
  district?: string;
  /** IANA time zone of the station's city, e.g. America/Toronto. Set only when derived from a real place; never guessed. */
  timeZone?: string;
  callSign?: string;
  format?: string;
  /** One-line description shown in the directory (max 160 chars). */
  description?: string;
  /** Genre labels used by the directory chips and search (max 5). */
  genres?: string[];
  language?: 'en' | 'fr' | 'es' | 'other';
  streamUrl: string;
  streamType: 'mp3' | 'aac' | 'hls' | 'icy';
  homepage?: string;
  logo?: string;
  enabled: boolean;
  verifiedAt?: string;
  corsVerified?: boolean;
  /** false = directory only (not a guide channel). Absent = true for the curated list in src/data/liveRadioSources.json. */
  inGuide?: boolean;
  /** Upstream directory id (radio-browser stationuuid), for traceability. */
  uuid?: string;
}

export const LIVE_RADIO_GROUP = 'Live Radio';

/** Station picture URL: https only, bounded length. Anything else is dropped (the panel then shows an initials tile). */
const LOGO_MAX_LENGTH = 290;
function sanitizeLogo(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  return v.length > 0 && v.length <= LOGO_MAX_LENGTH && v.startsWith('https://') ? v : undefined;
}

/** IANA zone shape (Area/Location[/Sub]). Regex on purpose: no dependency on the runtime's ICU data. */
const TIME_ZONE_RE = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){1,2}$/;

export function validateLiveRadioStations(raw: unknown[]): { valid: LiveRadioStation[]; rejected: Array<{ id: string; reason: string }> } {
  const valid: LiveRadioStation[] = [];
  const rejected: Array<{ id: string; reason: string }> = [];
  const seenIds = new Set<string>();

  if (!Array.isArray(raw)) {
    return { valid, rejected };
  }

  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      rejected.push({ id: 'unknown', reason: 'invalid station record' });
      continue;
    }
    const s = item as Record<string, unknown>;
    const id = typeof s.id === 'string' ? s.id.trim() : '';
    if (!id) {
      rejected.push({ id: 'unknown', reason: 'missing id' });
      continue;
    }
    if (!id.startsWith('radio:')) {
      rejected.push({ id, reason: 'id must start with radio:' });
      continue;
    }
    if (seenIds.has(id)) {
      rejected.push({ id, reason: 'duplicate id' });
      continue;
    }
    seenIds.add(id);

    const name = typeof s.name === 'string' ? s.name.trim() : '';
    if (!name) {
      rejected.push({ id, reason: 'missing name' });
      continue;
    }

    const streamUrl = typeof s.streamUrl === 'string' ? s.streamUrl.trim() : '';
    if (!streamUrl) {
      rejected.push({ id, reason: 'missing streamUrl' });
      continue;
    }
    if (!streamUrl.startsWith('https://')) {
      rejected.push({ id, reason: 'streamUrl not https://' });
      continue;
    }

    const country = s.country;
    if (country !== 'US' && country !== 'CA') {
      rejected.push({ id, reason: 'country not US or CA' });
      continue;
    }

    const streamType = s.streamType;
    if (streamType !== 'mp3' && streamType !== 'aac' && streamType !== 'hls' && streamType !== 'icy') {
      rejected.push({ id, reason: 'unknown streamType' });
      continue;
    }

    if (s.timeZone !== undefined && (typeof s.timeZone !== 'string' || !TIME_ZONE_RE.test(s.timeZone))) {
      rejected.push({ id, reason: 'invalid timeZone' });
      continue;
    }

    if (!s.verifiedAt || typeof s.verifiedAt !== 'string' || !s.verifiedAt.trim()) {
      rejected.push({ id, reason: 'not verified' });
      continue;
    }

    valid.push({
      id,
      name,
      country: country as 'US' | 'CA',
      region: typeof s.region === 'string' ? s.region : undefined,
      city: typeof s.city === 'string' ? s.city : undefined,
      district: typeof s.district === 'string' && s.district.trim() ? s.district.trim() : undefined,
      timeZone: typeof s.timeZone === 'string' ? s.timeZone : undefined,
      callSign: typeof s.callSign === 'string' ? s.callSign : undefined,
      format: typeof s.format === 'string' ? s.format : undefined,
      description: typeof s.description === 'string' && s.description.trim() ? s.description.trim().slice(0, 160) : undefined,
      genres: Array.isArray(s.genres) ? s.genres.filter((g): g is string => typeof g === 'string' && g.trim().length > 0).map((g) => g.trim()).slice(0, 5) : undefined,
      language: (s.language === 'en' || s.language === 'fr' || s.language === 'es' || s.language === 'other') ? s.language : undefined,
      streamUrl,
      streamType: streamType as 'mp3' | 'aac' | 'hls' | 'icy',
      homepage: typeof s.homepage === 'string' ? s.homepage : undefined,
      logo: sanitizeLogo(s.logo),
      enabled: Boolean(s.enabled),
      verifiedAt: s.verifiedAt,
      corsVerified: typeof s.corsVerified === 'boolean' ? s.corsVerified : undefined,
      inGuide: typeof s.inGuide === 'boolean' ? s.inGuide : undefined,
      uuid: typeof s.uuid === 'string' ? s.uuid : undefined,
    });
  }

  return { valid, rejected };
}

/** Curated list (client-visible JSON, in the guide) followed by the bulk directory and the Vancouver additions (server-only, directory only). */
function defaultRawStations(): unknown[] {
  const curated = ((liveRadioSourcesJson as { stations?: unknown[] })?.stations ?? []);
  const bulk = ((liveRadioDirectoryJson as { stations?: unknown[] })?.stations ?? []);
  const extra = [...((liveRadioVancouverJson as { stations?: unknown[] })?.stations ?? []), ...((liveRadioClassicHits109Json as { stations?: unknown[] })?.stations ?? [])];
  // An addition is skipped when the base lists already carry its id or stream URL, so a later merge into the bulk file never duplicates it.
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  for (const r of [...curated, ...bulk]) {
    const rec = r as { id?: unknown; streamUrl?: unknown };
    if (typeof rec?.id === 'string') seenIds.add(rec.id);
    if (typeof rec?.streamUrl === 'string') seenUrls.add(rec.streamUrl);
  }
  const additions = extra.filter((r) => {
    const rec = r as { id?: unknown; streamUrl?: unknown };
    return !(typeof rec?.id === 'string' && seenIds.has(rec.id)) && !(typeof rec?.streamUrl === 'string' && seenUrls.has(rec.streamUrl));
  });
  // Icons for stations already in the lists that have none: applied only when the record has no logo, never replacing one.
  const fallbacks = ((liveRadioVancouverJson as { logoFallbacks?: Record<string, string> })?.logoFallbacks ?? {});
  // Extra genre labels for stations already in the base lists (union, existing labels first; validation caps the list at 5).
  const genreAdds = ((liveRadioClassicHits109Json as { genreAdditions?: Record<string, string[]> })?.genreAdditions ?? {});
  const descAdds = ((liveRadioClassicHits109Json as { descriptionAdditions?: Record<string, string> })?.descriptionAdditions ?? {});
  const withLogo = (r: unknown): unknown => {
    const rec = r as { id?: unknown; logo?: unknown; genres?: unknown; description?: unknown };
    let out: unknown = typeof rec?.id === 'string' && !rec.logo && fallbacks[rec.id] ? { ...(r as object), logo: fallbacks[rec.id] } : r;
    if (typeof rec?.id === 'string' && descAdds[rec.id]) out = { ...(out as object), description: descAdds[rec.id] };
    const adds = typeof rec?.id === 'string' ? genreAdds[rec.id] : undefined;
    if (adds && adds.length) {
      const have = Array.isArray(rec.genres) ? (rec.genres as unknown[]).filter((g): g is string => typeof g === 'string') : [];
      const merged = [...have, ...adds.filter((g) => !have.some((h) => h.toLocaleLowerCase() === g.toLocaleLowerCase()))];
      out = { ...(out as object), genres: merged };
    }
    return out;
  };
  return [...curated, ...bulk, ...additions].map(withLogo);
}

let validatedCache: { valid: LiveRadioStation[]; rejected: Array<{ id: string; reason: string }> } | null = null;

/** Validates the default sources once per process (the bulk list is ~2.3k records). An override is always validated fresh. */
function validatedStations(stationsOverride?: unknown[]): { valid: LiveRadioStation[]; rejected: Array<{ id: string; reason: string }> } {
  const override = stationsOverride;
  if (override) return validateLiveRadioStations(override);
  if (!validatedCache) validatedCache = validateLiveRadioStations(defaultRawStations());
  return validatedCache;
}

export function getLiveRadioStatus(): { stations: number; enabled: number; guide: number; rejected: Array<{ id: string; reason: string }> } {
  const { valid, rejected } = validatedStations();
  const enabled = valid.filter((s) => s.enabled);
  return {
    stations: valid.length,
    enabled: enabled.length,
    guide: enabled.filter((s) => s.inGuide !== false).length,
    rejected: rejected.slice(0, 100),
  };
}

export function buildLiveRadioChannels(
  stations: LiveRadioStation[],
  guideId: string,
  layout?: (programs: Program[], hours: number, now: Date, startHour: number) => Program[],
): ScheduleChannel[] {
  // Directory-only stations (inGuide === false) are never guide channels: they would shift every guide number and bloat the schedule.
  const enabled = stations.filter((s) => s.enabled && s.inGuide !== false);
  if (enabled.length === 0) return [];

  const now = new Date();
  const dayStartUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayEndUtc = new Date(dayStartUtc.getTime() + 24 * 3600_000);

  return enabled.map((station) => {
    const baseProgram: Program = {
      id: `${station.id}:live`,
      guideId,
      channelId: station.id,
      title: station.name,
      description: station.format ? `${station.name} (${station.format})` : station.name,
      startTime: 0,
      endTime: 24,
      startHour: 0,
      endHour: 24,
      startTimeUtc: dayStartUtc.toISOString(),
      endTimeUtc: dayEndUtc.toISOString(),
      mediaType: 'audio',
      mediaUrl: station.streamUrl,
      archivePath: station.streamUrl,
      sourceClass: 'm3u_live',
      isArchivedSource: false,
      metadata: {
        isLive: true,
        country: station.country,
        ...(station.region ? { region: station.region } : {}),
        ...(station.city ? { city: station.city } : {}),
        ...(station.callSign ? { callSign: station.callSign } : {}),
        ...(station.format ? { format: station.format } : {}),
      },
    };

    const laidOut = typeof layout === 'function' ? layout([baseProgram], 24 * 60, now, 1) : [baseProgram];
    const programs = laidOut.length > 0 ? laidOut : [baseProgram];
    programs[0].title = station.name;
    programs[0].sourceClass = 'm3u_live';
    programs[0].isArchivedSource = false;
    programs[0].mediaUrl = station.streamUrl;
    programs[0].archivePath = station.streamUrl;

    return {
      id: station.id,
      guideId,
      name: station.name,
      mediaType: 'audio' as const,
      group: LIVE_RADIO_GROUP,
      ...(station.logo ? { logo: station.logo } : {}),
      programs: [programs[0]],
    };
  });
}

export async function getLiveRadioChannels(
  guideId: string,
  layout?: (programs: Program[], hours: number, now: Date, startHour: number) => Program[],
  stationsOverride?: unknown[],
): Promise<ScheduleChannel[]> {
  const { valid } = validatedStations(stationsOverride);
  return buildLiveRadioChannels(valid, guideId, layout);
}

/** Same id the guide uses for a station's one program (layoutDailySchedule appends ":d0"). The meter flag and history key on it. */
export function liveRadioProgramId(stationId: string): string {
  return `${stationId}:live:d0`;
}

export interface LiveRadioListItem {
  id: string;
  /** Stable station number (see server/data/liveRadioNumbers.json). Absent for a station not yet numbered. */
  number?: number;
  name: string;
  country: 'US' | 'CA';
  city?: string;
  region?: string;
  timeZone?: string;
  callSign?: string;
  description?: string;
  genres: string[];
  streamUrl: string;
  streamType: 'mp3' | 'aac' | 'hls' | 'icy';
  homepage?: string;
  logo?: string;
  corsVerified?: boolean;
  inGuide: boolean;
  programId: string;
}

export interface LiveRadioQuery { q?: string; country?: string; region?: string; city?: string; genre?: string; ids?: string; /** '1' = only visualizer-ready (corsVerified) stations. */ viz?: string; page?: number; pageSize?: number }
export interface LiveRadioPage {
  total: number;
  page: number;
  pageSize: number;
  items: LiveRadioListItem[];
  /** Facets. Countries and genres cover ALL shown stations so the chips do not vanish while filtering. */
  countries: Array<'US' | 'CA'>;
  genres: string[];
  /** States / provinces of the selected country (both countries when none is selected). */
  regions: string[];
  /** Cities of the selected region. Empty until a region is chosen (the list would be huge). */
  cities: string[];
  /** Visualizer-ready (corsVerified) stations among ALL shown stations, regardless of the active filters. */
  vizTotal: number;
}

export const LIVE_RADIO_DEFAULT_PAGE_SIZE = 24;
export const LIVE_RADIO_MAX_PAGE_SIZE = 100;
/** Genre chips: the most common labels first, capped. Any genre is still reachable through search. */
export const LIVE_RADIO_MAX_GENRE_FACETS = 30;

/** Stable station numbers (append-only registry keyed by station id). A station without one simply shows no number. */
const STATION_NUMBERS = ((liveRadioNumbersJson as { numbers?: Record<string, number> })?.numbers ?? {});

function toListItem(s: LiveRadioStation): LiveRadioListItem {
  return {
    id: s.id, name: s.name, country: s.country,
    ...(Object.prototype.hasOwnProperty.call(STATION_NUMBERS, s.id) ? { number: STATION_NUMBERS[s.id] } : {}),
    ...(s.city ? { city: s.city } : {}), ...(s.region ? { region: s.region } : {}),
    ...(s.timeZone ? { timeZone: s.timeZone } : {}), ...(s.callSign ? { callSign: s.callSign } : {}),
    ...(s.description ? { description: s.description } : {}),
    genres: s.genres && s.genres.length > 0 ? s.genres : (s.format ? [s.format] : []),
    streamUrl: s.streamUrl, streamType: s.streamType,
    ...(s.homepage ? { homepage: s.homepage } : {}), ...(s.logo ? { logo: s.logo } : {}),
    ...(typeof s.corsVerified === 'boolean' ? { corsVerified: s.corsVerified } : {}),
    inGuide: s.inGuide !== false,
    programId: liveRadioProgramId(s.id),
  };
}

let listCache: LiveRadioListItem[] | null = null;

function shownItems(stationsOverride?: unknown[]): LiveRadioListItem[] {
  const override = stationsOverride;
  if (!override && listCache) return listCache;
  const items = validatedStations(override ?? undefined).valid.filter((s) => s.enabled).map(toListItem).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  if (!override) listCache = items;
  return items;
}

const sortedUnique = (values: Array<string | undefined>): string[] => [...new Set(values.filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b));

/** Directory query. Only stations that are valid, verified AND enabled are ever listed. Pure and synchronous: no network. */
export function queryLiveRadioStations(query: LiveRadioQuery = {}, stationsOverride?: unknown[]): LiveRadioPage {
  const all = shownItems(stationsOverride);
  const countries = [...new Set(all.map((s) => s.country))].sort() as Array<'US' | 'CA'>;
  const genreCounts = new Map<string, number>();
  for (const s of all) for (const g of s.genres) genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
  const genres = [...genreCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, LIVE_RADIO_MAX_GENRE_FACETS).map(([g]) => g);

  const q = (query.q ?? '').trim().toLocaleLowerCase();
  const country = (query.country ?? '').trim().toUpperCase();
  const region = (query.region ?? '').trim().toLocaleLowerCase();
  const city = (query.city ?? '').trim().toLocaleLowerCase();
  const genre = (query.genre ?? '').trim().toLocaleLowerCase();
  // "#123" = exactly station 123. A bare number matches station 123 AND any text containing it (e.g. "Classic Hits 109").
  const numQ = /^#?\d{1,6}$/.test(q) ? Number(q.replace('#', '')) : null;
  const vizOnly = (query.viz ?? '').trim() === '1';
  const vizTotal = all.filter((s) => s.corsVerified === true).length;
  const ids = new Set((query.ids ?? '').split(',').map((x) => x.trim()).filter(Boolean));

  const inCountry = country ? all.filter((s) => s.country === country) : all;
  const regions = sortedUnique(inCountry.map((s) => s.region));
  const inRegion = region ? inCountry.filter((s) => (s.region ?? '').toLocaleLowerCase() === region) : [];
  const cities = region ? sortedUnique(inRegion.map((s) => s.city)) : [];

  const filtered = all.filter((s) => {
    if (ids.size > 0 && !ids.has(s.id)) return false;
    if (vizOnly && s.corsVerified !== true) return false;
    if (country && s.country !== country) return false;
    if (region && (s.region ?? '').toLocaleLowerCase() !== region) return false;
    if (city && (s.city ?? '').toLocaleLowerCase() !== city) return false;
    if (genre && !s.genres.some((g) => g.toLocaleLowerCase() === genre)) return false;
    if (q && q.startsWith('#') && numQ !== null) return s.number === numQ;
    if (q) {
      if (numQ !== null && s.number === numQ) return true;
      const hay = [s.name, s.callSign, s.city, s.region, s.country, s.description, ...s.genres].filter(Boolean).join(' ').toLocaleLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const pageSize = Math.min(LIVE_RADIO_MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(query.pageSize)) || LIVE_RADIO_DEFAULT_PAGE_SIZE));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(pages, Math.max(1, Math.floor(Number(query.page)) || 1));
  return { total: filtered.length, page, pageSize, items: filtered.slice((page - 1) * pageSize, page * pageSize), countries, genres, regions, cities, vizTotal };
}
