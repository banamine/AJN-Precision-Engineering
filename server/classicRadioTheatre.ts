import { createHash } from 'node:crypto';
import registryJson from '../src/data/classicRadioTheatreRegistry.json';
import { archiveApiFetch } from './archiveLimiter';

export type ClassicRadioGenre = 'drama' | 'mystery-suspense' | 'sci-fi' | 'true-crime';

export interface ClassicRadioShow {
  id: string;
  displayName: string;
  aliases: string[];
  genre: ClassicRadioGenre;
  era: string;
  eraVerified: boolean;
  measured: boolean;
  preferredArchiveSource: {
    collectionIds: string[];
    creatorCandidates: string[];
    evidence: string;
  };
}

export interface ClassicRadioResult {
  showId: string;
  genre: ClassicRadioGenre;
  identifier: string;
  title: string;
  creator: string | null;
  date: string | null;
  path: string;
  mediaType: 'audio';
  alternateGroup?: string;
}

export interface ClassicRadioSearchResponse {
  showId: string;
  genre: ClassicRadioGenre;
  page: number;
  limit: number;
  total: number;
  unavailableCount: number;
  results: ClassicRadioResult[];
}

export class ClassicRadioUpstreamError extends Error {
  constructor(
    message: string,
    readonly upstreamStatus?: number,
    readonly retryAfter?: string | null,
  ) {
    super(message);
    this.name = 'ClassicRadioUpstreamError';
  }
}

export const CLASSIC_RADIO_PAGE_MAX = 48;
export const CLASSIC_RADIO_CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 128;
const AUDIO_PREFERENCE = ['mp3', 'ogg', 'm4a', 'aac', 'wav', 'flac'] as const;
const USER_AGENT = 'AJN-Precision-Engineering/1.0 (Classic Radio Theatre; public audio search)';
const shows = (registryJson as { shows: ClassicRadioShow[] }).shows;
const GENRES: ClassicRadioGenre[] = ['drama', 'mystery-suspense', 'sci-fi', 'true-crime'];

/** NFKC, case-fold, punctuation-fold, and make a leading "The" optional. */
export function normalizeClassicRadioAlias(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^the\s+/, '')
    .replace(/\s+/g, ' ');
}

const aliasIndex = new Map<string, ClassicRadioShow>();
for (const show of shows) {
  for (const alias of [show.displayName, ...show.aliases]) {
    const key = normalizeClassicRadioAlias(alias);
    if (key && !aliasIndex.has(key)) aliasIndex.set(key, show);
  }
}

export function findClassicRadioShow(alias: unknown): ClassicRadioShow | null {
  return aliasIndex.get(normalizeClassicRadioAlias(alias)) ?? null;
}

export function getClassicRadioGenres(): Array<{ genre: ClassicRadioGenre; shows: Array<Pick<ClassicRadioShow, 'id' | 'displayName' | 'measured'>> }> {
  return GENRES.map((genre) => ({
    genre,
    shows: shows
      .filter((show) => show.genre === genre)
      .map(({ id, displayName, measured }) => ({ id, displayName, measured })),
  }));
}

function quotePhrase(value: string): string {
  const safe = value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  return `"${safe.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function buildClassicRadioArchiveQuery(show: ClassicRadioShow, episodeQuery = ''): string {
  const aliases = [...new Set([show.displayName, ...show.aliases].map((x) => x.trim()).filter(Boolean))];
  const titleAliases = aliases.map((alias) => `title:${quotePhrase(alias)}`).join(' OR ');
  const collections = show.preferredArchiveSource.collectionIds.map((id) => `collection:${quotePhrase(id)}`);
  const creators = show.preferredArchiveSource.creatorCandidates.map((creator) => `creator:${quotePhrase(creator)}`);
  const sourceScope = [...collections, ...creators].join(' OR ');
  const q = episodeQuery.trim().slice(0, 120);
  const episodeScope = q
    ? /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(q)
      ? `date:${quotePhrase(q)}`
      : `title:${quotePhrase(q)}`
    : '';
  return [
    'mediatype:audio',
    `(${titleAliases})`,
    sourceScope ? `(${sourceScope})` : '',
    episodeScope ? `(${episodeScope})` : '',
  ].filter(Boolean).join(' AND ');
}

function oneString(value: unknown, max = 300): string | null {
  const candidate = Array.isArray(value) ? value.find((v) => typeof v === 'string') : value;
  if (typeof candidate !== 'string') return null;
  const clean = candidate.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, max) : null;
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 160 &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !value.includes('..');
}

function isPrivate(file: Record<string, unknown>): boolean {
  return file.private === true || String(file.private ?? '').toLowerCase() === 'true';
}

function audioExtension(name: string): typeof AUDIO_PREFERENCE[number] | null {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return AUDIO_PREFERENCE.includes(ext as typeof AUDIO_PREFERENCE[number]) ? ext as typeof AUDIO_PREFERENCE[number] : null;
}

export function selectPublicAudioPath(identifier: string, files: unknown): string | null {
  if (!Array.isArray(files)) return null;
  const candidates = files
    .filter((file): file is Record<string, unknown> => Boolean(file) && typeof file === 'object')
    .map((file) => {
      const name = oneString(file.name, 240);
      const ext = name ? audioExtension(name) : null;
      if (!name || !ext || isPrivate(file) || name.includes('/') || name.includes('\\') || name.includes('..')) return null;
      const size = Number(file.size);
      if (Number.isFinite(size) && size <= 0) return null;
      return { name, ext, preference: AUDIO_PREFERENCE.indexOf(ext) };
    })
    .filter((x): x is { name: string; ext: typeof AUDIO_PREFERENCE[number]; preference: number } => x !== null)
    .sort((a, b) => a.preference - b.preference || a.name.localeCompare(b.name));
  const selected = candidates[0];
  if (!selected) return null;
  return `/download/${encodeURIComponent(identifier)}/${encodeURIComponent(selected.name)}`;
}

function fullDate(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month && d.getUTCDate() === day ? value : null;
}

function alternateKey(result: ClassicRadioResult): string | null {
  const date = fullDate(result.date);
  if (!date) return null;
  const title = normalizeClassicRadioAlias(result.title);
  if (!title) return null;
  return `${result.showId}\u001f${title}\u001f${date}`;
}

export function dedupeAndMarkClassicRadioAlternates(results: ClassicRadioResult[]): ClassicRadioResult[] {
  const byIdentifier = new Map<string, ClassicRadioResult>();
  for (const result of results) {
    const previous = byIdentifier.get(result.identifier);
    if (!previous || result.path.localeCompare(previous.path) < 0) byIdentifier.set(result.identifier, result);
  }
  const deduped = [...byIdentifier.values()];
  const groups = new Map<string, ClassicRadioResult[]>();
  for (const result of deduped) {
    const key = alternateKey(result);
    if (key) groups.set(key, [...(groups.get(key) ?? []), result]);
  }
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const groupId = `alt-${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
    for (const result of group) result.alternateGroup = groupId;
  }
  return deduped;
}

interface ArchiveDoc { identifier?: unknown; title?: unknown; creator?: unknown; date?: unknown; mediatype?: unknown }
interface SearchBody { response?: { numFound?: unknown; docs?: ArchiveDoc[] } }
interface MetadataBody { files?: Array<Record<string, unknown>>; metadata?: { mediatype?: unknown; is_dark?: unknown; private?: unknown } }
export interface ClassicRadioServiceDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export function createClassicRadioService(deps: ClassicRadioServiceDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? archiveApiFetch;
  const now = deps.now ?? Date.now;
  const cache = new Map<string, { expiresAt: number; value: ClassicRadioSearchResponse }>();
  const inflight = new Map<string, Promise<ClassicRadioSearchResponse>>();

  async function fetchJson<T>(url: string): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
    } catch (error) {
      throw new ClassicRadioUpstreamError(error instanceof Error ? error.message : 'Archive fetch failed');
    }
    if (!response.ok) {
      const retryAfter = response.headers.get('retry-after');
      throw new ClassicRadioUpstreamError(
        `Archive HTTP ${response.status}${retryAfter ? ` (Retry-After ${retryAfter})` : ''}`,
        response.status,
        retryAfter,
      );
    }
    try {
      return await response.json() as T;
    } catch {
      throw new ClassicRadioUpstreamError('Archive returned invalid JSON');
    }
  }

  async function playableResult(show: ClassicRadioShow, doc: ArchiveDoc): Promise<ClassicRadioResult | null> {
    if (!validIdentifier(doc.identifier) || (doc.mediatype && doc.mediatype !== 'audio')) return null;
    const metadata = await fetchJson<MetadataBody>(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`);
    if (String(metadata.metadata?.private ?? '').toLowerCase() === 'true' ||
        String(metadata.metadata?.is_dark ?? '').toLowerCase() === 'true' ||
        (metadata.metadata?.mediatype && metadata.metadata.mediatype !== 'audio')) return null;
    const path = selectPublicAudioPath(doc.identifier, metadata.files);
    if (!path) return null;
    const title = oneString(doc.title, 240);
    if (!title) return null;
    return {
      showId: show.id,
      genre: show.genre,
      identifier: doc.identifier,
      title,
      creator: oneString(doc.creator, 180),
      date: oneString(doc.date, 40),
      path,
      mediaType: 'audio',
    };
  }

  async function mapConcurrent<T, R>(values: T[], concurrency: number, fn: (value: T) => Promise<R>): Promise<R[]> {
    const out = new Array<R>(values.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (true) {
        const index = next++;
        if (index >= values.length) return;
        out[index] = await fn(values[index]);
      }
    }));
    return out;
  }

  async function search(input: {
    show: string;
    q?: string;
    genre?: string;
    page?: number;
    limit?: number;
  }): Promise<ClassicRadioSearchResponse> {
    const show = shows.find((candidate) => candidate.id === input.show) ?? findClassicRadioShow(input.show);
    if (!show) throw new RangeError('unknown_show');
    if (input.genre && input.genre !== show.genre) throw new RangeError('show_genre_mismatch');
    const page = Number.isInteger(input.page) && Number(input.page) > 0 ? Number(input.page) : 1;
    const limit = Math.max(1, Math.min(CLASSIC_RADIO_PAGE_MAX, Number(input.limit) || 1));
    const q = String(input.q ?? '').trim().slice(0, 120);
    const key = JSON.stringify([show.id, q.toLocaleLowerCase('en-US'), page, limit]);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) return cached.value;
    const pending = inflight.get(key);
    if (pending) return pending;

    const run = (async (): Promise<ClassicRadioSearchResponse> => {
      const archiveQuery = buildClassicRadioArchiveQuery(show, q);
      const url = new URL('https://archive.org/advancedsearch.php');
      url.searchParams.set('q', archiveQuery);
      for (const field of ['identifier', 'title', 'creator', 'date', 'mediatype']) url.searchParams.append('fl[]', field);
      url.searchParams.set('rows', String(limit));
      url.searchParams.set('page', String(page));
      url.searchParams.append('sort[]', 'downloads desc');
      url.searchParams.set('output', 'json');
      const body = await fetchJson<SearchBody>(url.toString());
      const docs = Array.isArray(body.response?.docs) ? body.response!.docs! : [];
      const total = Math.max(0, Number(body.response?.numFound) || 0);
      let unavailableCount = 0;
      const resolved = await mapConcurrent(docs.slice(0, limit), 3, async (doc) => {
        try {
          const result = await playableResult(show, doc);
          if (!result) unavailableCount += 1;
          return result;
        } catch (error) {
          if (error instanceof ClassicRadioUpstreamError && [403, 404, 410].includes(error.upstreamStatus ?? 0)) {
            unavailableCount += 1;
            return null;
          }
          throw error;
        }
      });
      const response: ClassicRadioSearchResponse = {
        showId: show.id,
        genre: show.genre,
        page,
        limit,
        total,
        unavailableCount,
        results: dedupeAndMarkClassicRadioAlternates(resolved.filter((x): x is ClassicRadioResult => Boolean(x))),
      };
      if (response.results.length > 0) {
        if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
        cache.set(key, { expiresAt: now() + CLASSIC_RADIO_CACHE_TTL_MS, value: response });
      }
      return response;
    })();
    inflight.set(key, run);
    try { return await run; } finally { inflight.delete(key); }
  }

  return { search, cacheSize: () => cache.size };
}

export const classicRadioService = createClassicRadioService();
