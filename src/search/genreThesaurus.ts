/* Genre / intent thesaurus (Entry 042 §4). Typing a broad word ("classic movies", "dance", "tv") also matches whole
 * pools, not just titles that contain the word. A pool is either real library category ids (the server index already
 * tags every record with them) or extra title/description terms for pools the index has no category for. Nothing here
 * hardcodes titles or counts: counts come from the live query result. Pure, shared by server and client. */
import { joinedKey } from './normalize';

export interface Genre { id: string; label: string; aliases: string[]; categoryIds: string[]; terms: string[] }

export const GENRE_THESAURUS: Genre[] = [
  { id: 'classic-movies', label: 'Classic Movies', categoryIds: ['classic-cinema', 'movie-vault', 'silent-films'], terms: [],
    aliases: ['classic movies', 'old movies', 'classic cinema', 'cinema classics', 'vintage films', 'golden age', 'b&w', 'black and white'] },
  { id: 'colorized', label: 'Colorized & Restored', categoryIds: [], terms: ['colorized', 'colorised', 'colorization', 'remastered'],
    aliases: ['new movies', 'colorized', 'colorized movies', 'color', 'remastered', 'modern restorations', 'colorized classics'] },
  { id: 'dance', label: 'Dance', categoryIds: [], terms: ['dance', 'disco', 'techno', 'edm', 'club'],
    aliases: ['dance', 'dance music', 'electronic', 'disco', 'club', 'edm', 'beats', 'techno', 'house'] },
  { id: 'tv', label: 'Classic TV', categoryIds: ['classic-tv', 'classic-tv-channels', 'soaps'], terms: [],
    aliases: ['tv', 'television', 'classic tv', 'series', 'sitcom', 'shows', 'episodes'] },
  { id: 'westerns', label: 'Westerns', categoryIds: [], terms: ['western', 'cowboy', 'frontier', 'gunsmoke', 'wagon train', 'wyatt earp', 'death valley days'],
    aliases: ['western', 'westerns', 'cowboy', 'frontier', 'gunslinger', 'saloon', 'wyatt earp'] },
  { id: 'cartoons', label: 'Cartoons', categoryIds: ['cartoons'], terms: ['animation', 'animated'],
    aliases: ['cartoons', 'cartoon', 'animation', 'animated', 'toon', 'classic cartoons'] },
  { id: 'sci-fi', label: 'Sci-Fi & Space', categoryIds: ['scifi-horror', 'aerospace', 'apollo'], terms: [],
    aliases: ['sci-fi', 'scifi', 'science fiction', 'space', 'alien', 'galaxy', 'nasa', 'apollo'] },
  { id: 'comedy', label: 'Comedy', categoryIds: [], terms: ['comedy', 'sitcom', 'laugh'],
    aliases: ['comedy', 'funny', 'humor', 'sitcom', 'laughs'] },
  { id: 'rock', label: 'Rock & Concerts', categoryIds: [], terms: ['concert', 'soundboard', 'live at', 'woodstock'],
    aliases: ['rock', 'classic rock', 'concert', 'concerts', 'live music', 'soundboard'] },
  { id: 'news', label: 'News', categoryIds: ['newsroom', 'newsreels'], terms: [],
    aliases: ['news', 'tv news', 'politics', 'election', 'debate', 'congress', 'senate'] },
];

const key = (s: string) => joinedKey(s);
const ALIAS_KEYS = GENRE_THESAURUS.map((g) => ({ g, keys: g.aliases.map(key) }));

/** Genres whose alias equals the typed text exactly (a word can belong to several, e.g. "sitcom"). */
export function resolveGenres(query: string): Genre[] {
  const q = key(query);
  if (!q) return [];
  return ALIAS_KEYS.filter(({ keys }) => keys.includes(q)).map(({ g }) => g);
}

/** Genres a half-typed word could be heading for (alias starts with it), for the typeahead; needs 3+ characters. */
export function genresByPrefix(query: string): Genre[] {
  const q = key(query);
  if (q.length < 3) return [];
  return ALIAS_KEYS.filter(({ keys }) => keys.some((k) => k.startsWith(q))).map(({ g }) => g);
}

/** Does a record belong to any of these genre pools? */
export function inGenrePools(genres: Genre[], rec: { categoryIds?: string[] }, matches: (term: string) => boolean): boolean {
  return genres.some((g) => (rec.categoryIds ?? []).some((c) => g.categoryIds.includes(c)) || g.terms.some(matches));
}
