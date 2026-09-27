export type LibrarySeriesCategory = 'cartoons' | 'classic-tv' | 'old-time-radio';

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
}

export interface SeriesEpisode extends SeriesSource {
  episodeTitle: string;
  season?: number;
  episode?: number;
}

export interface LibrarySeries {
  type: 'series';
  id: string;
  groupKey: string;
  title: string;
  categoryIds: string[];
  mediaType: 'video' | 'audio';
  episodeCount: number;
  episodes: SeriesEpisode[];
  groupingMethod: 'separator-title';
}

export type LibraryResult = SeriesSource & { type: 'item' } | LibrarySeries;

const GROUPABLE = new Set<LibrarySeriesCategory>(['cartoons', 'classic-tv', 'old-time-radio']);

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
  if (/\b\d{3,4}\s+episodes?\b/i.test(suffix)) return null;
  return { prefix, suffix };
}

function categoryFor(r: SeriesSource): LibrarySeriesCategory | undefined {
  for (const c of r.categoryIds) if (GROUPABLE.has(c as LibrarySeriesCategory)) return c as LibrarySeriesCategory;
  return undefined;
}

function episodeOrder(a: SeriesEpisode, b: SeriesEpisode) {
  return (a.season ?? 9999) - (b.season ?? 9999)
    || (a.episode ?? 9999) - (b.episode ?? 9999)
    || (a.year ?? 9999) - (b.year ?? 9999)
    || a.episodeTitle.localeCompare(b.episodeTitle)
    || a.identifier.localeCompare(b.identifier);
}

export function groupLibraryResults(rows: SeriesSource[]): LibraryResult[] {
  const groups = new Map<string, SeriesEpisode[]>();
  const singles: SeriesSource[] = [];
  for (const row of rows) {
    const category = categoryFor(row);
    const parsed = category ? separatorPrefix(row.title) : null;
    if (!category || !parsed) { singles.push(row); continue; }
    const key = category + ':' + norm(parsed.prefix);
    const episode: SeriesEpisode = { ...row, episodeTitle: parsed.suffix };
    const list = groups.get(key);
    if (list) list.push(episode); else groups.set(key, [episode]);
  }

  const grouped: LibraryResult[] = [...groups.entries()].flatMap(([groupKey, episodes]) => {
    if (episodes.length < 2) return episodes.map(({ episodeTitle: _episodeTitle, ...item }) => ({ ...item, type: 'item' as const }));
    episodes.sort(episodeOrder);
    const first = episodes[0];
    const categoryIds = [...new Set(episodes.flatMap((e) => e.categoryIds))];
    return [{
      type: 'series' as const,
      id: 'series-' + groupKey.replace(/[^a-z0-9:_-]+/gi, '-'),
      groupKey,
      title: clean(groupKey.slice(groupKey.indexOf(':') + 1)).replace(/\b\w/g, (m) => m.toUpperCase()),
      categoryIds,
      mediaType: first.mediaType,
      episodeCount: episodes.length,
      episodes,
      groupingMethod: 'separator-title' as const,
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
