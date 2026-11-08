/* Four series channels whose source files are Archive.org ZIP MEMBERS (Babylon 5, Agents of S.H.I.E.L.D., Star Trek DS9,
 * Stargate Atlantis). A zip member cannot be played (Archive ignores Range, the MP4 index is at the end) and has no known
 * length, so an episode becomes a scheduled item ONLY when data/zipmember-fastcopies.json holds a verified fast-start copy
 * with a real duration. No entry -> no episode -> the channel is not listed (collections/series-channel.ts hides empty
 * channels). Nothing here invents a duration or substitutes other media. */
import type { SeriesConfig } from './series-config';
import { parseEpisodeName, type Manifest, type ManifestEpisode } from './series-parse';
import fastCopies from '../data/zipmember-fastcopies.json';

const mk = (key: string, name: string): SeriesConfig => ({ key, channelId: `classic-series-${key}`, name, series: name, group: 'Classic TV', items: [] });
export const ZIPMEMBER_SERIES: SeriesConfig[] = [
  mk('sc-babylon-5', 'Babylon 5'),
  mk('sc-agents-of-shield', "Marvel's Agents of S.H.I.E.L.D."),
  mk('sc-star-trek-ds9', 'Star Trek: Deep Space Nine'),
  mk('sc-stargate-atlantis', 'Stargate Atlantis'),
];
const ITEM_PREFIX: Array<[string, string]> = [
  ['babylon-5-', 'sc-babylon-5'], ['marvels-agents-of-shield-', 'sc-agents-of-shield'],
  ['star-trek-ds9-', 'sc-star-trek-ds9'], ['stargate-atlantis-', 'sc-stargate-atlantis'],
];

/** Pure. Entry shape: { url, durationSec, bytes?, source? }. Accepts only a direct https://archive.org/download/<id>/<file>.mp4
 *  (a ".zip/" member url has an extra path segment and is refused) with durationSec > 0. Returns only series that have episodes. */
export function buildZipmemberManifests(entries: unknown): Record<string, Manifest> {
  const rows = Array.isArray(entries) ? entries : [];
  const eps = new Map<string, ManifestEpisode[]>();
  const issues = new Map<string, string[]>();
  const seen = new Set<string>();
  const note = (k: string, s: string) => issues.set(k, [...(issues.get(k) ?? []), s]);
  for (const raw of rows) {
    const e = (raw ?? {}) as Record<string, unknown>;
    const url = typeof e.url === 'string' ? e.url : '';
    const m = url.match(/^https:\/\/archive\.org\/download\/([^/?#]+)\/([^/?#]+\.mp4)$/i);
    const dur = Number(e.durationSec);
    if (!m || !Number.isFinite(dur) || dur <= 0) continue;
    const identifier = decodeURIComponent(m[1]);
    const fileName = decodeURIComponent(m[2]);
    const hit = ITEM_PREFIX.find(([p]) => identifier.toLowerCase().startsWith(p));
    if (!hit) continue;
    const key = hit[1];
    const p = parseEpisodeName(fileName);
    if (!p || p.season === undefined) { note(key, `${fileName}: no season/episode in the file name, skipped`); continue; }
    const dedupe = `${key}|${p.season}|${p.episode}`;
    if (seen.has(dedupe)) { note(key, `S${p.season}E${p.episode} listed twice, kept the first`); continue; }
    seen.add(dedupe);
    const pair = p.title.match(/^0*(\d{1,3})\b/);                     // "S01E01-02" -> a two-part file
    const title = pair ? `Episodes ${p.episode}-${Number(pair[1])}` : (p.title.replace(/\bEng\b.*$/i, '').trim() || `Episode ${p.episode}`);
    const list = eps.get(key) ?? [];
    list.push({ season: p.season, episode: p.episode, title, identifier, fileName, path: `/download/${m[1]}/${m[2]}`,
      format: 'fast-start MP4 copy', sizeBytes: Number(e.bytes) || 0, durationSeconds: Math.round(dur), durationEstimated: false });
    eps.set(key, list);
  }
  const out: Record<string, Manifest> = {};
  for (const cfg of ZIPMEMBER_SERIES) {
    const list = (eps.get(cfg.key) ?? []).sort((a, b) => a.season - b.season || a.episode - b.episode);
    if (!list.length) continue;
    const seasons: Manifest['seasons'] = [];
    for (const s of [...new Set(list.map((x) => x.season))]) {
      const nums = list.filter((x) => x.season === s).map((x) => x.episode);
      const first = Math.min(...nums), last = Math.max(...nums);
      const missing: number[] = []; for (let i = 1; i <= last; i++) if (!nums.includes(i)) missing.push(i);
      seasons.push({ season: s, episodes: nums.length, first, last, missing });
    }
    const ids = [...new Set(list.map((x) => x.identifier))];
    out[cfg.key] = { key: cfg.key, channelId: cfg.channelId, name: cfg.name, series: cfg.series, group: cfg.group, episodes: list, seasons,
      items: ids.map((id) => ({ identifier: id, ok: true, videoFiles: list.filter((x) => x.identifier === id).length, episodes: list.filter((x) => x.identifier === id).length })),
      issues: issues.get(cfg.key) ?? [] };
  }
  return out;
}
export const zipmemberManifests = (): Record<string, Manifest> => buildZipmemberManifests(fastCopies);
