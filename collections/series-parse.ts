/* Pure helpers: turn an Archive item's file list into a season/episode manifest. No network, no Node APIs. */
import type { SeriesConfig, SeriesItemConfig } from './series-config';

export interface ParsedName { season?: number; episode: number; title: string }
export interface ManifestEpisode {
  season: number; episode: number; title: string; identifier: string; fileName: string; path: string;
  format: string; sizeBytes: number; durationSeconds: number; durationEstimated: boolean;
  /** Archive-generated frame for this episode, relative to the item (e.g. "<id>.thumbs/<episode>_000486.jpg"); absent when Archive made none. */
  thumb?: string;
}
export interface Manifest {
  key: string; channelId: string; name: string; series: string; group: string;
  episodes: ManifestEpisode[]; seasons: Array<{ season: number; episodes: number; first: number; last: number; missing: number[] }>;
  items: Array<{ identifier: string; season?: number; ok: boolean; videoFiles: number; episodes: number; error?: string }>;
  issues: string[];
}

const clean = (s: string) => s.replace(/[._]+/g, (m) => (m.length ? ' ' : m)).replace(/\s+/g, ' ').replace(/^[\s\-–_:]+|[\s\-–_:]+$/g, '').trim();
const stemOf = (name: string) => name.replace(/\.[^.\/]+$/, '').replace(/\.ia$/i, '');

/** Recognizes: "Show_S01E02_Title", "Taxi - S04E02 - Title", "Taxi S02E01 Title", "Taxi 1x01 Title", "Episode 10 Title". */
export function parseEpisodeName(fileName: string): ParsedName | null {
  const stem = stemOf(fileName.split('/').pop() ?? fileName);
  let m = stem.match(/S(\d{1,2})\s*E(\d{1,3})(?!\d)(.*)$/i);
  if (m) return { season: +m[1], episode: +m[2], title: clean(m[3]) };
  m = stem.match(/(?:^|[^\d])(\d{1,2})x(\d{1,3})(?!\d)(.*)$/i);
  if (m) return { season: +m[1], episode: +m[2], title: clean(m[3]) };
  m = stem.match(/^\s*episode\s*(\d{1,3})(?!\d)(.*)$/i);
  if (m) return { episode: +m[1], title: clean(m[2]) };
  // Single-season uploads named "Rob E01 (Pilot)": a bare E-number after a space, no season in the name.
  m = stem.match(/(?:^|\s)E(\d{1,3})(?!\d)(.*)$/);
  if (m) return { episode: +m[1], title: clean(m[2]) };
  return null;
}

/** Middle frame of the Archive-generated frames for one episode file (the first frame is usually black). Pure. */
export function pickEpisodeThumb(files: any[], identifier: string, fileName: string): string | undefined {
  const stem = fileName.replace(/\.[^./]+$/, '').replace(/\.ia$/i, '');
  const prefix = `${identifier}.thumbs/${stem}_`;
  const frames = files.map((f) => String(f?.name ?? '')).filter((n) => n.startsWith(prefix) && /_\d{6}\.jpg$/i.test(n)).sort();
  if (!frames.length) return undefined;
  return frames[Math.floor(frames.length / 2)];
}

/** "the.protectors.108..mp4" -> S1E08: opt-in per item (numbering 'sxx'); the first digit is the season, the last two the episode. */
export function parseSxxName(fileName: string): ParsedName | null {
  const stem = stemOf(fileName.split('/').pop() ?? fileName).replace(/[.\s_-]+$/, '');
  const m = stem.match(/(?:^|[^\d])(\d)(\d{2})$/);
  return m ? { season: +m[1], episode: +m[2], title: '' } : null;
}

const VIDEO_EXT = /\.(mp4|m4v|webm|avi|mkv|mpg|mpeg|mov|ogv)$/i;

/** Group an item's video files by episode stem (".ia.mp4" derivatives and originals fall in the same group). */
export function groupEpisodes(files: any[], hint?: number, numbering?: 'sxx') {
  const groups = new Map<string, { parsed: ParsedName & { season: number }; files: any[] }>();
  const unparsed: string[] = [];
  for (const f of files) {
    const name = String(f?.name ?? '');
    if (!VIDEO_EXT.test(name) || name.includes('.thumbs/')) continue;
    const p = parseEpisodeName(name) ?? (numbering === 'sxx' ? parseSxxName(name) : null);
    const season = p?.season ?? hint;
    if (!p || season === undefined) { unparsed.push(name); continue; }
    const key = `${season}|${p.episode}`;
    const g = groups.get(key) ?? { parsed: { ...p, season }, files: [] };
    g.files.push(f); if (p.title.length > g.parsed.title.length) g.parsed.title = p.title;
    groups.set(key, g);
  }
  return { groups, unparsed };
}

export function buildManifest(
  cfg: SeriesConfig,
  items: Array<{ cfg: SeriesItemConfig; meta?: any; error?: string }>,
  deps: { parseEpisodeName: typeof parseEpisodeName; groupEpisodes: typeof groupEpisodes; selectPlayableFile: (...a: any[]) => any; findSexWord: (f: Record<string, unknown>) => string | null },
): Manifest {
  const episodes: ManifestEpisode[] = []; const issues: string[] = []; const itemInfo: Manifest['items'] = [];
  const seen = new Map<string, string>();
  for (const it of items) {
    if (!it.meta) { issues.push(`${it.cfg.identifier}: ${it.error ?? 'no metadata'}`); itemInfo.push({ identifier: it.cfg.identifier, season: it.cfg.seasonHint, ok: false, videoFiles: 0, episodes: 0, error: it.error }); continue; }
    const files: any[] = it.meta.files ?? [];
    const { groups, unparsed } = deps.groupEpisodes(files, it.cfg.seasonHint, it.cfg.numbering);
    if (unparsed.length) issues.push(`${it.cfg.identifier}: ${unparsed.length} video file(s) without a season/episode number skipped (e.g. ${unparsed.slice(0, 2).join(' | ')})`);
    let n = 0;
    for (const g of [...groups.values()].sort((a, b) => a.parsed.season - b.parsed.season || a.parsed.episode - b.parsed.episode)) {
      const sex = deps.findSexWord({ title: g.parsed.title, file: g.files[0]?.name });
      if (sex) { issues.push(`${it.cfg.identifier}: S${g.parsed.season}E${g.parsed.episode} excluded by SEX word rule`); continue; }
      const sel = deps.selectPlayableFile(it.cfg.identifier, g.files, it.meta.metadata?.runtime, 'video');
      if (!sel.canonicalPath) { issues.push(`${it.cfg.identifier}: S${g.parsed.season}E${g.parsed.episode} has no browser-playable file (${sel.selectedBecause})`); continue; }
      const key = `${g.parsed.season}|${g.parsed.episode}`;
      if (seen.has(key)) { issues.push(`S${g.parsed.season}E${g.parsed.episode} appears in ${seen.get(key)} and ${it.cfg.identifier}; kept the first`); continue; }
      seen.set(key, it.cfg.identifier);
      const f = g.files.find((x) => x.name === sel.filename);
      episodes.push({ season: g.parsed.season, episode: g.parsed.episode, title: g.parsed.title || `Episode ${g.parsed.episode}`, identifier: it.cfg.identifier,
        fileName: sel.filename, path: sel.canonicalPath, format: sel.format, sizeBytes: Number(f?.size) || 0,
        durationSeconds: Math.round(sel.durationSeconds), durationEstimated: !!sel.durationEstimated,
        ...(pickEpisodeThumb(files, it.cfg.identifier, sel.filename) ? { thumb: pickEpisodeThumb(files, it.cfg.identifier, sel.filename) } : {}) });
      n++;
    }
    itemInfo.push({ identifier: it.cfg.identifier, season: it.cfg.seasonHint, ok: true, videoFiles: files.filter((f) => VIDEO_EXT.test(String(f?.name)) && !String(f.name).includes('.thumbs/')).length, episodes: n });
  }
  episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
  const seasons: Manifest['seasons'] = [];
  for (const s of [...new Set(episodes.map((e) => e.season))]) {
    const nums = episodes.filter((e) => e.season === s).map((e) => e.episode);
    const first = Math.min(...nums), last = Math.max(...nums);
    const missing: number[] = []; for (let i = 1; i <= last; i++) if (!nums.includes(i)) missing.push(i);
    seasons.push({ season: s, episodes: nums.length, first, last, missing });
    if (missing.length) issues.push(`Season ${s}: episode number(s) ${missing.join(', ')} not found in the source item(s)`);
  }
  return { key: cfg.key, channelId: cfg.channelId, name: cfg.name, series: cfg.series, group: cfg.group, episodes, seasons, items: itemInfo, issues };
}
