/* Pure logic for the Shows detail panel (Dusk skin): season tabs, episode filtering and "Why it plays" chips.
 * Every chip is built from a real field of the show row or its episode list; nothing is estimated or invented.
 * No React, no network, no random values. */
export interface ShowFacts {
  episodes: number; hours: number | null; in24x7: boolean; tags: string[];
  verification: { ok: boolean; date: string; method: string };
}
export interface EpisodeFacts { t: string; p: string; d: number; s?: number; e?: number }
export interface SeasonTab { season: number; count: number }
export interface WhyChip { id: string; label: string; tone: 'ok' | 'info' | 'warn'; source: string }

export const ALL_SEASONS = 'all';

/** Distinct real season numbers (from `s`), ascending, with their episode counts. Empty when the list has no season data. */
export function seasonsOf(eps: readonly EpisodeFacts[]): SeasonTab[] {
  const m = new Map<number, number>();
  for (const ep of eps) if (typeof ep.s === 'number' && Number.isFinite(ep.s)) m.set(ep.s, (m.get(ep.s) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([season, count]) => ({ season, count }));
}

/** Episodes of one season (or all) whose title contains `query` (case-insensitive). Order is the list's own order. */
export function filterEpisodes(eps: readonly EpisodeFacts[], season: number | typeof ALL_SEASONS, query: string): EpisodeFacts[] {
  const q = query.trim().toLowerCase();
  return eps.filter((ep) => (season === ALL_SEASONS || ep.s === season) && (!q || ep.t.toLowerCase().includes(q)));
}

/** Mean episode length in whole minutes over episodes that report a length; null when none do. */
export function avgMinutes(eps: readonly EpisodeFacts[]): number | null {
  const lens = eps.map((e) => e.d).filter((d) => d > 0);
  return lens.length ? Math.round(lens.reduce((a, b) => a + b, 0) / lens.length / 60) : null;
}

/** The "Why it plays" chips. A failed or missing check is shown as a warning chip, never hidden. */
export function whyItPlays(show: ShowFacts, eps: readonly EpisodeFacts[] | null): WhyChip[] {
  const chips: WhyChip[] = [];
  chips.push(show.verification.ok
    ? { id: 'range', label: `Range-checked ${show.verification.date}`, tone: 'ok', source: `verification.ok = true (${show.verification.method}): the first and last file answered a Range request on ${show.verification.date}` }
    : { id: 'range', label: 'Not range-checked', tone: 'warn', source: 'verification.ok = false: playback of this show has not been confirmed' });
  chips.push({ id: 'count', label: `${show.episodes} episode${show.episodes === 1 ? '' : 's'}`, tone: 'info', source: 'show.episodes' });
  if (show.hours !== null) chips.push({ id: 'hours', label: `${show.hours} h of video`, tone: 'info', source: 'show.hours' });
  if (eps) {
    const seasons = seasonsOf(eps);
    if (seasons.length) chips.push({ id: 'seasons', label: `${seasons.length} season${seasons.length === 1 ? '' : 's'}`, tone: 'info', source: 'distinct episode.s values in the episode list' });
    const avg = avgMinutes(eps);
    if (avg !== null) chips.push({ id: 'avg', label: `About ${avg} min each`, tone: 'info', source: 'mean of episode.d (seconds) over episodes that report a length' });
  }
  if (show.in24x7) chips.push({ id: '247', label: 'In the 24/7 schedule', tone: 'ok', source: 'show.in24x7 = true' });
  for (const t of show.tags) chips.push({ id: `tag:${t}`, label: t, tone: 'info', source: 'show.tags' });
  return chips;
}

export const epCode = (ep: EpisodeFacts): string => (ep.s !== undefined ? `S${String(ep.s).padStart(2, '0')}E${String(ep.e ?? 0).padStart(2, '0')}` : '');
