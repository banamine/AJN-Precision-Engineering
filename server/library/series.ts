export type LibrarySeriesCategory = 'cartoons' | 'classic-tv' | 'old-time-radio' | 'soaps';

export interface SeriesFile {
  id: string;
  identifier: string;
  file: string;
  path: string;
  durationSeconds: number;
  bytes: number;
  part?: { number: number; total: number; variant?: 'a' | 'b' } | null;
}

export interface SeriesSource {
  id: string;
  identifier: string;
  title: string;
  categoryIds: string[];
  mediaType: 'video' | 'audio';
  year?: number;
  decade?: number;
  path: string;
  format: string;
  dur: number;
  durEst: boolean;
  availability: string;
  description?: string;
  channelId?: string;
  guideId?: string;
  programId?: string;
  seriesEligible?: boolean;
  seriesKey?: string;
  seriesTitle?: string;
  seriesEpisodeTitle?: string;
  subtitle?: string;
  airDate?: string;
  episodeNumber?: number;
  kindBadge?: string;
  sourceFile?: string;
  searchTerms?: string[];
  parts?: SeriesFile[];
  alternates?: SeriesFile[];
}

export interface SeriesEpisode extends SeriesSource {
  episodeTitle: string;
  season?: number;
  episode?: number;
}

export interface LibrarySeriesYear { year: number; count: number }

export interface LibrarySeries {
  type: 'series';
  id: string;
  groupKey: string;
  title: string;
  categoryIds: string[];
  mediaType: 'video' | 'audio';
  episodeCount: number;
  episodes: SeriesEpisode[];
  groupingMethod: 'separator-title' | 'air-date-episode';
  years?: LibrarySeriesYear[];
  poster?: { identifier: string; path: string };
}

export type LibraryResult = SeriesSource & { type: 'item' } | LibrarySeries;

const GROUPABLE = new Set<LibrarySeriesCategory>(['cartoons', 'classic-tv', 'old-time-radio', 'soaps']);

const clean = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim();
const norm = (s: string) => clean(s).toLocaleLowerCase().replace(/[’']/g, "'").replace(/\s*[-–—:]\s*/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

function separatorPrefix(title: string): { prefix: string; suffix: string } | null {
  const s = clean(title);
  if (/[\[\]{}()]/.test(s)) return null;
  if (/\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(s)) return null;
  const m = /^(.{1,80}?)(?: - |: )(.+)$/.exec(s);
  if (!m) return null;
  const prefix = clean(m[1]);
  const suffix = clean(m[2]);
  const words = prefix.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 5 || suffix.length < 2) return null;
  if (/^(?:\d{4}|\d{1,4}\s+episodes?)$/i.test(suffix)) return null;
  if (/\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(suffix)) return null;
  if (/\b\d{2,5}\s+episodes?\b/i.test(suffix)) return null;           // "508 Episodes", "1254 Episodes of…" = whole-show compilations
  if (/^(single|complete|all|selected)\s+episodes?\b/i.test(suffix)) return null; // "Single Episodes…" compilations
  if (/\brecordings?\b/i.test(suffix)) return null;                        // "Mercury Theater - 1938 recordings" = a set, not an episode
  return { prefix, suffix };
}

function categoryFor(r: SeriesSource): LibrarySeriesCategory | undefined {
  for (const c of r.categoryIds) if (GROUPABLE.has(c as LibrarySeriesCategory)) return c as LibrarySeriesCategory;
  return undefined;
}

function episodeOrder(a: SeriesEpisode, b: SeriesEpisode) {
  if (a.airDate || b.airDate) return (a.airDate ?? '9999').localeCompare(b.airDate ?? '9999')
    || (a.episodeNumber ?? a.episode ?? 999999) - (b.episodeNumber ?? b.episode ?? 999999)
    || a.episodeTitle.localeCompare(b.episodeTitle)
    || a.identifier.localeCompare(b.identifier);
  return (a.season ?? 9999) - (b.season ?? 9999)
    || (a.episode ?? 9999) - (b.episode ?? 9999)
    || (a.year ?? 9999) - (b.year ?? 9999)
    || a.episodeTitle.localeCompare(b.episodeTitle)
    || a.identifier.localeCompare(b.identifier);
}

export function groupLibraryResults(rows: SeriesSource[]): LibraryResult[] {
  const groups = new Map<string, { title: string; groupingMethod: LibrarySeries['groupingMethod']; episodes: SeriesEpisode[] }>();
  const singles: SeriesSource[] = [];
  for (const row of rows) {
    const category = categoryFor(row);
    const explicit = category === 'soaps'
      && row.seriesEligible === true
      && typeof row.seriesKey === 'string'
      && typeof row.seriesTitle === 'string'
      && typeof row.seriesEpisodeTitle === 'string'
      && typeof row.airDate === 'string';
    const parsed = explicit
      ? { prefix: row.seriesTitle!, suffix: row.seriesEpisodeTitle! }
      : category && category !== 'soaps' ? separatorPrefix(row.title) : null;
    if (!category || !parsed) { singles.push(row); continue; }
    const groupingMethod = explicit ? 'air-date-episode' : 'separator-title';
    const key = explicit
      ? `soaps:${norm(row.seriesKey!)}`
      : category + ':' + norm(parsed.prefix);
    const episode: SeriesEpisode = {
      ...row,
      episodeTitle: parsed.suffix,
      ...(row.episodeNumber !== undefined ? { episode: row.episodeNumber } : {}),
    };
    const group = groups.get(key);
    if (group) group.episodes.push(episode);
    else groups.set(key, { title: parsed.prefix, groupingMethod, episodes: [episode] });
  }

  const grouped: LibraryResult[] = [...groups.entries()].flatMap(([groupKey, group]): LibraryResult[] => {
    const { title, groupingMethod } = group;
    const episodes = group.episodes;
    if (episodes.length < 2 && groupingMethod !== 'air-date-episode') {
      return episodes.map(({ episodeTitle: _episodeTitle, ...item }) => ({ ...item, type: 'item' as const }));
    }
    episodes.sort(episodeOrder);
    const first = episodes[0];
    const categoryIds = [...new Set(episodes.flatMap((e) => e.categoryIds))];
    const byYear = new Map<number, number>();
    for (const episode of episodes) if (typeof episode.year === 'number') {
      byYear.set(episode.year, (byYear.get(episode.year) ?? 0) + 1);
    }
    return [{
      type: 'series' as const,
      id: 'series-' + groupKey.replace(/[^a-z0-9:_-]+/gi, '-'),
      groupKey,
      title: groupingMethod === 'separator-title'
        ? separatorPrefix(first.title)?.prefix ?? clean(groupKey.slice(groupKey.indexOf(':') + 1))
        : title,
      categoryIds,
      mediaType: first.mediaType,
      episodeCount: episodes.length,
      episodes,
      groupingMethod,
      ...(groupingMethod === 'air-date-episode' ? {
        years: [...byYear].map(([year, count]) => ({ year, count })).sort((a, b) => a.year - b.year),
        poster: { identifier: first.identifier, path: first.path },
      } : {}),
    }];
  });

  return [...singles.map((r) => ({ ...r, type: 'item' as const })), ...grouped]
    .sort((a, b) => {
      const ay = a.type === 'series' ? a.episodes[0]?.year : a.year;
      const by = b.type === 'series' ? b.episodes[0]?.year : b.year;
      return (ay ?? 9999) - (by ?? 9999) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
    });
}

export function findLibrarySeries(rows: SeriesSource[], key: string): LibrarySeries | null {
  const result = groupLibraryResults(rows).find((r): r is LibrarySeries => r.type === 'series' && r.groupKey === key);
  return result ?? null;
}
