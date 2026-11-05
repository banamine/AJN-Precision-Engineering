import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { digest, type NetworkAsset, type NetworkCatalog } from '../server/classicNetwork';

type Row = Record<string, unknown>;
export interface Exclusion { file: string; id: string; reason: string; evidence: string }
export const SHOWS: Record<string, RegExp> = {
  'hogans-heroes': /hogan'?s[ ._-]*heroes/i,
  taxi: /\btaxi\b/i, benson: /\bbenson\b/i, 'get-smart': /get[ ._-]+smart/i,
  'odd-couple': /odd[ ._-]+couple/i, 'dick-van-dyke': /dick[ ._-]+van[ ._-]+dyke/i,
  'danger-man': /danger[ ._-]+man|secret[ ._-]+agent/i,
  'death-valley-days': /death[ ._-]+valley[ ._-]+days/i,
};
export function episodeCode(text: string): { season: number; episode: number } | null {
  const m = /S(\d{1,2})[\s._-]*E(\d{1,3})/i.exec(text)
    ?? /(?:^|[\s/._-])(\d{1,2})x(\d{1,3})(?=\D|$)/i.exec(text)
    ?? /Season[\s._-]+(\d{1,2})[\s._-]+Episode[\s._-]+(\d{1,3})/i.exec(text);
  return m ? { season: Number(m[1]), episode: Number(m[2]) } : null;
}
export function collectRows(value: unknown, context: Row = {}, out: Row[] = []): Row[] {
  if (Array.isArray(value)) { value.forEach(v => collectRows(v, context, out)); return out; }
  if (!value || typeof value !== 'object') return out;
  const r = value as Row;
  const next = { ...context, ...(typeof r.item === 'string' ? { identifier: r.item } : {}),
    ...(typeof r.identifier === 'string' ? { identifier: r.identifier } : {}),
    ...(typeof r.name === 'string' ? { channelName: r.name } : {}),
    ...(typeof r.guideId === 'string' ? { guideId: r.guideId } : {}),
    ...(typeof r.id === 'string' ? { channelId: r.id } : {}) };
  if (typeof (r.file ?? r.fileName) === 'string' || (typeof r.path === 'string' && /\.mp4$/i.test(r.path))) {
    out.push({ ...context, ...r });
    return out;
  }
  for (const v of Object.values(r)) if (v && typeof v === 'object') collectRows(v, next, out);
  return out;
}
function fileOf(r: Row): string { return String(r.file ?? r.fileName ?? r.path ?? ''); }
export function episodeDisplayTitle(file: string, fallback: string): string {
  let name = file.split('/').pop() || fallback;
  try { name = decodeURIComponent(name); } catch { /* Preserve malformed legacy file labels verbatim. */ }
  const cleaned = name.replace(/\.(?:mp4|m4v|avi|mkv)$/i, '').replace(/\.(?:ia|h264)$/i, '')
    .replace(/^\d{1,4}[\s._-]+/, '').replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || fallback;
}
/** The FILE name must itself name the show (wrong-show rows such as "Cagney & Lacey ... Taxi-Cab Murders" matched on context only). */
export function fileNamesShow(show: string, file: string, identifier: string): boolean {
  if (show === 'danger-man') return /danger[ ._-]*man|secret[ ._-]*agent/i.test(identifier);
  if (show === 'odd-couple') return /odd[ ._-]+couple/i.test(file);
  const base = (file.split('/').pop() ?? file).replace(/^[\d\s._-]+/, '').replace(/^the[ ._-]+/i, '');
  return new RegExp(`^(?:${SHOWS[show].source})`, 'i').test(base);
}
function reject(excluded: Exclusion[], r: Row, reason: string): void {
  excluded.push({ file: fileOf(r), id: String(r.identifier ?? ''), reason, evidence: String(r.title ?? r.channelName ?? '') });
}
export function buildCatalog(rows: Row[], movie = false, includeChannels: string[] = []): {
  catalog: NetworkCatalog; excluded: Exclusion[]; sameFileMultipleKeys: string[]; reviewFlags: Exclusion[];
} {
  const excluded: Exclusion[] = [], chosen = new Map<string, { asset: NetworkAsset; rank: number; bytes: number }>();
  const reviewFlags: Exclusion[] = [];
  for (const r of rows) {
    const file = fileOf(r), id = String(r.identifier ?? ''), title = String(r.title ?? path.basename(file));
    const context = `${r.channelName ?? ''} ${r.series ?? ''} ${title} ${file}`;
    const show = Object.keys(SHOWS).find(k => SHOWS[k].test(context));
    if (!movie && !show) continue;
    if (movie && !includeChannels.includes(String(r.channelId))) { reject(excluded, r, 'channel_not_in_owner_allowlist'); continue; }
    if (r.private || r.is_dark || r.restricted || r.durationEstimated === true) { reject(excluded, r, 'private_or_unverified_duration'); continue; }
    const duration = Number(r.durationSeconds);
    if (!Number.isFinite(duration) || duration <= 0) { reject(excluded, r, 'missing_real_duration'); continue; }
    if (!id || !/\.mp4$/i.test(file)) { reject(excluded, r, 'no_mp4_or_identifier'); continue; }
    if (movie && (duration < 3600 || duration > 14400)) { reject(excluded, r, 'outside_60_240_minutes'); continue; }
    if (!movie && show === 'odd-couple' && (!file.startsWith('VOM/The Odd Couple S01-S05 (1970-)/') || /Xtras|1968/i.test(file))) {
      reject(excluded, r, 'outside_odd_couple_episode_prefix'); continue;
    }
    if (!movie && show === 'hogans-heroes' && /hogan[ ._-]+family/i.test(file)) { reject(excluded, r, 'wrong_show'); continue; }
    if (!movie && show && !fileNamesShow(show, file, id)) { reject(excluded, r, 'file_name_does_not_name_show'); continue; }
    const code = episodeCode(file);
    let episodeKey: string;
    if (movie) {
      if (code || /\b(?:episode|chapter|season)[ ._-]*\d{1,2}(?!\d)/i.test(file) ||
        ['short', 'trailer', 'serial'].includes(String(r.kind)) || /\((?:short film|trailer|serial)\)/i.test(title)) {
        reject(excluded, r, 'short_trailer_or_serial'); continue;
      }
      const identity = movieIdentity(title, r.year, id, file);
      if (!identity) { reject(excluded, r, 'untitled_movie'); continue; }
      episodeKey = identity;
      if (show) reviewFlags.push({ file, id, reason: 'film_title_overlaps_series_name', evidence: title });
    } else if (code) {
      episodeKey = `${show}:s${String(code.season).padStart(2, '0')}e${String(code.episode).padStart(2, '0')}`;
    } else {
      // Existing Danger Man filenames explicitly number their running order; never use the item id.
      const order = show === 'danger-man' ? /(?:^|\/)(\d{1,3})[ ._-]+/.exec(file) : null;
      if (!order) { reject(excluded, r, 'unresolved_episode_order'); continue; }
      const seriesFolder = /Series[ ._-]*(\d+)/i.exec(file)?.[1] ?? '0';
      episodeKey = `${show}:o${String(Number(seriesFolder) * 1000 + Number(order[1])).padStart(5, '0')}`;
    }
    const encoded = file.split('/').map(encodeURIComponent).join('/');
    const archivePath = `/download/${encodeURIComponent(id)}/${encoded}`;
    const asset: NetworkAsset = {
      episodeKey, assetId: String(r.id ?? `cnasset-${digest({ id, file }).slice(0, 20)}`),
      show: movie ? 'movies' : show!, title: movie ? title : episodeDisplayTitle(file, title), archivePath, durationSeconds: duration,
      ...(code && !movie ? code : {}), sources: [String(r.channelId ?? '')],
    };
    const rank = /\.ia\.mp4$/i.test(file) || /h\.?264/i.test(String(r.format)) ? 0 : 1;
    const bytes = Number(r.bytes ?? r.sizeBytes ?? (movie ? r.size : undefined) ?? Number.MAX_SAFE_INTEGER);
    const old = chosen.get(episodeKey);
    if (!old) chosen.set(episodeKey, { asset, rank, bytes });
    else {
      const keepNew = rank < old.rank || (rank === old.rank && (bytes < old.bytes || (bytes === old.bytes && archivePath < old.asset.archivePath)));
      const sources = [...new Set([...old.asset.sources, ...asset.sources])].sort();
      if (keepNew) { reject(excluded, { file: old.asset.archivePath, identifier: old.asset.assetId }, 'duplicate_episode_rendition'); chosen.set(episodeKey, { asset: { ...asset, sources }, rank, bytes }); }
      else { reject(excluded, r, 'duplicate_episode_rendition'); old.asset.sources = sources; }
    }
  }
  const assets = [...chosen.values()].map(v => v.asset).sort((a, b) => a.show.localeCompare(b.show) || a.episodeKey.localeCompare(b.episodeKey, 'en', { numeric: true }));
  const paths = new Map<string, Set<string>>();
  for (const a of assets) { const keys = paths.get(a.archivePath) ?? new Set<string>(); keys.add(a.episodeKey); paths.set(a.archivePath, keys); }
  return { catalog: { schema: 1, assets }, excluded,
    sameFileMultipleKeys: [...paths].filter(([, keys]) => keys.size > 1).map(([p]) => p), reviewFlags };
}
export function movieIdentity(title: string, yearField: unknown, id: string, file: string): string | null {
  let name = title.replace(/\.mp4$/i, '').replace(/\b(?:1080p|720p|480p|mp4|ia|bluray|dvdrip)\b/gi, '').trim();
  const declared = /^(?:18|19|20)\d{2}$/.exec(String(yearField ?? ''))?.[0];
  const trailing = /.+?(?:[\s._-]|\(|\[)((?:18|19|20)\d{2})(?:\s|\)|\]|[._-])*$/.exec(name)?.[1];
  const year = declared ?? trailing;
  if (year) {
    const withoutYear = name.replace(new RegExp(`\\b${year}\\b\\s*[)\\]]?\\s*$`), '');
    if (/[\p{L}\p{N}]/u.test(withoutYear)) name = withoutYear;
  }
  const normalized = name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  if (!normalized || /^(?:movie|film|video|untitled|unknown)(?:-?\d+)?$/.test(normalized)) return null;
  return `movie:${year ? `${normalized}:${year}` : `${id}:${file}`}`;
}
export function orderMovies(assets: NetworkAsset[], seed: string): NetworkAsset[] {
  if (!seed) throw new Error('Movies seed is required');
  const hashes = new Map(assets.map(a => [a.episodeKey, createHash('sha256').update(seed + a.episodeKey).digest('hex')]));
  return [...assets].sort((a, b) => hashes.get(a.episodeKey)!.localeCompare(hashes.get(b.episodeKey)!) || a.episodeKey.localeCompare(b.episodeKey));
}
export function assertMovieCycle(assets: NetworkAsset[]): number {
  const seconds = assets.reduce((n, a) => n + a.durationSeconds, 0);
  if (seconds <= 168 * 3600) throw new Error('Movies full cycle must exceed 168 real hours');
  return seconds;
}
export function movieVaultRows(items: Array<Record<string, unknown>>): Row[] {
  return items.flatMap(item => (Array.isArray(item.files) ? item.files : []).map(f => ({
    ...f, identifier: item.identifier, title: item.title, year: item.year, file: f.name,
    durationSeconds: f.durationSeconds ?? f.length ?? item.durationSeconds,
    channelId: 'classic-cinema', guideId: 'movies-classics-vault',
    private: item.private, is_dark: item.is_dark, restricted: item.restricted,
  })));
}
export function readAppRows(): Row[] {
  const files = ['extraChannelsManifest', 'seriesManifests', 'organizerShowsManifest', 'archiveShowSourcesManifest', 'archiveItemManifest.guide'];
  return files.flatMap(f => collectRows(JSON.parse(fs.readFileSync(`src/data/${f}.json`, 'utf8')) as unknown));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const movie = process.argv.includes('--movies');
  let includes: string[] = [], seed = '';
  let rows = readAppRows();
  if (movie) {
    const settings = JSON.parse(fs.readFileSync('config/classic-networks.json', 'utf8'));
    const config = settings.networks['classic-movies'];
    if (!Array.isArray(config?.includeChannels) || !config.seed) throw new Error('Movies includeChannels and seed are required');
    includes = [...config.includeChannels]; seed = config.seed;
    const extra = JSON.parse(fs.readFileSync('src/data/extraChannelsManifest.json', 'utf8')) as { channels: Array<{ id: string }> };
    includes.push(...extra.channels.filter(c => c.id.startsWith('mx-movies-classics-list-')).map(c => c.id));
    rows = rows.filter(r => r.guideId === 'movies-classics-vault');
    rows.push(...movieVaultRows(JSON.parse(fs.readFileSync('src/data/moviesClassicsManifest.json', 'utf8'))));
  }
  const result = buildCatalog(rows, movie, includes);
  if (movie) { result.catalog.assets = orderMovies(result.catalog.assets, seed); assertMovieCycle(result.catalog.assets); }
  const file = movie ? 'classicMoviesCatalog' : 'classicNetworkCatalog';
  fs.writeFileSync(`src/data/${file}.json`, `${JSON.stringify(result.catalog, null, 2)}\n`);
  fs.mkdirSync('reports/classic-network', { recursive: true });
  fs.writeFileSync(`reports/classic-network/${file}-exclusions.json`, `${JSON.stringify({ excluded: result.excluded, sameFileMultipleKeys: result.sameFileMultipleKeys, reviewFlags: result.reviewFlags }, null, 2)}\n`);
  const table = [...new Set(result.catalog.assets.map(a => a.show))].map(show => {
    const a = result.catalog.assets.filter(v => v.show === show), seconds = a.reduce((s, v) => s + v.durationSeconds, 0);
    return { show, distinctEpisodes: a.length, totalHours: seconds / 3600, meanSeconds: seconds / a.length, maxAiringsPerDay: Math.floor(a.length / 7) };
  });
  console.log(JSON.stringify({ catalog: file, table, excluded: result.excluded.length, sameFileMultipleKeys: result.sameFileMultipleKeys }, null, 2));
}
