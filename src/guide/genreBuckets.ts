/* Genre buckets for the TV Guide pill bar. Pure: no React, no DOM, no network.
 * A channel can belong to MANY genre pills (Comedy + Drama, Action + Sci-Fi ...).
 * Sources, in order: (1) show-info metadata linked by channel id, (2) show-info metadata matched by normalized show title,
 * (3) a small curated table for well-known series that are not in showInfo.json, (4) conservative name keywords.
 * Channels that match nothing keep the catch-all "Classic TV" pill. Real data only; nothing is invented. */
import { SHOW_INFO_FILE, getShowInfoByChannelId } from '../showinfo/lookup';
import type { ScheduleChannel } from '../types';

export interface CategoryDescriptor { id: string; label: string }

/** Ids are the folded label, so previously saved pill choices ("westerns", "cartoons", "soap operas", "classic tv") still resolve. */
const mk = (label: string): CategoryDescriptor => ({ id: label.toLowerCase(), label });
export const GENRE = {
  comedy: mk('Comedy'),
  drama: mk('Drama'),
  scifi: mk('Sci-Fi'),
  action: mk('Action & Adventure'),
  crime: mk('Crime & Mystery'),
  horror: mk('Horror & Thriller'),
  war: mk('War & History'),
  family: mk('Family & Kids'),
  westerns: mk('Westerns'),
} as const;
export const CLASSIC_TV: CategoryDescriptor = mk('Classic TV');
export const CATCH_ALL_ID = CLASSIC_TV.id;

/** Raw TVmaze-style tag -> viewer-facing bucket. Unlisted tags (Sports, Nature) add nothing. */
const RAW_TO_BUCKET: Record<string, CategoryDescriptor> = {
  comedy: GENRE.comedy, drama: GENRE.drama, romance: GENRE.drama,
  action: GENRE.action, adventure: GENRE.action,
  'science-fiction': GENRE.scifi, fantasy: GENRE.scifi,
  crime: GENRE.crime, mystery: GENRE.crime, espionage: GENRE.crime,
  horror: GENRE.horror, thriller: GENRE.horror, supernatural: GENRE.horror,
  war: GENRE.war, history: GENRE.war,
  family: GENRE.family, children: GENRE.family,
  western: GENRE.westerns,
};

/** Groups whose channels get genre enrichment. Other guides (News, Movies, Radio ...) keep their own group pills untouched. */
const ENRICHED_GROUPS = new Set(['classic tv', 'westerns', 'cartoons', 'soap operas']);

const fold = (s: string): string => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\*/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** "The Jeffersons (complete TV series)" / "Taxi — All Seasons" / "Amen: Season 1" -> "jeffersons" / "taxi" / "amen". */
export function titleKey(name: string): string {
  let s = fold(name);
  s = s.split(/ [—–-] |: /)[0];
  s = s.replace(/\([^)]*\)/g, '');
  s = s.replace(/\b(complete|full|tv|series|season|seasons|episodes?|all)\b.*$/, '');
  s = s.replace(/^(the|a|an) /, '');
  return s.replace(/[^a-z0-9]+/g, ' ').trim();
}

let byTitle: Map<string, string[]> | null = null;
function showInfoByTitle(): Map<string, string[]> {
  if (byTitle) return byTitle;
  byTitle = new Map();
  for (const show of SHOW_INFO_FILE?.shows ?? []) {
    const k = titleKey(show.title);
    if (k && !byTitle.has(k)) byTitle.set(k, show.genres);
  }
  return byTitle;
}

/** Well-known series missing from showInfo.json. Keys are titleKey() output. */
const CURATED: Record<string, CategoryDescriptor[]> = {
  jeffersons: [GENRE.comedy], 'good times': [GENRE.comedy], 'mister ed': [GENRE.comedy], fish: [GENRE.comedy], rob: [GENRE.comedy],
  'baa baa black sheep': [GENRE.war, GENRE.action, GENRE.drama],
  'little house on the prairie': [GENRE.drama, GENRE.family], waltons: [GENRE.drama, GENRE.family],
  'barnaby jones': [GENRE.crime], protectors: [GENRE.crime, GENRE.action],
  'adventures of sherlock holmes 1954': [GENRE.crime], 'wanted dead or alive': [GENRE.westerns], bonanza: [GENRE.westerns, GENRE.drama],
  'mr rogers neighborhood': [GENRE.family], buccaneers: [GENRE.action],
  'alien nation': [GENRE.scifi, GENRE.crime], thriller: [GENRE.horror],
};

/** Conservative whole-word keywords on the channel name, last resort. */
const KEYWORDS: Array<[RegExp, CategoryDescriptor]> = [
  [/western/, GENRE.westerns],
  [/(crime|detective|mystery|murder|scotland yard)/, GENRE.crime],
  [/\b(sitcom|comedy)\b/, GENRE.comedy],
  [/\b(sci fi|science fiction|space)\b/, GENRE.scifi],
  [/\b(horror|ghost|haunted)\b/, GENRE.horror],
  [/\b(kids|children|cartoon)\b/, GENRE.family],
];

function fromRaw(tags: readonly string[], out: Map<string, CategoryDescriptor>): void {
  for (const t of tags) { const b = RAW_TO_BUCKET[fold(t)]; if (b) out.set(b.id, b); }
}

/** Genre buckets for a channel's show (no group handling). Exported for tests. */
export function genresForChannel(channel: Pick<ScheduleChannel, 'id' | 'name'>): CategoryDescriptor[] {
  const out = new Map<string, CategoryDescriptor>();
  const linked = getShowInfoByChannelId(channel.id);
  const key = titleKey(channel.name);
  if (linked) fromRaw(linked.genres, out);
  else if (key && showInfoByTitle().has(key)) fromRaw(showInfoByTitle().get(key)!, out);
  else if (key && CURATED[key]) for (const b of CURATED[key]) out.set(b.id, b);
  else { const f = fold(channel.name); for (const [re, b] of KEYWORDS) if (re.test(f)) out.set(b.id, b); }
  return [...out.values()];
}

const cache = new WeakMap<object, CategoryDescriptor[]>();

/** Every pill this channel belongs to. Never empty. */
export function categoriesOf(c: ScheduleChannel): CategoryDescriptor[] {
  const hit = cache.get(c);
  if (hit) return hit;
  const label = (c.group ?? '').trim() || (c.mediaType === 'audio' ? 'Audio' : 'Video');
  const base: CategoryDescriptor = { id: fold(label), label };
  let result: CategoryDescriptor[];
  if (!ENRICHED_GROUPS.has(base.id)) result = [base];
  else {
    const genres = genresForChannel(c);
    if (base.id === CATCH_ALL_ID) result = genres.length ? genres : [CLASSIC_TV];
    else result = [base, ...genres.filter((g) => g.id !== base.id)];
  }
  cache.set(c, result);
  return result;
}
