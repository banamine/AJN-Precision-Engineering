/** Build the 8 genre-channel catalogs (5 TV + 3 movie) and register them in config/classic-networks.json.
 *  Run from the repo root:  npx tsx tools/build-genre-catalogs.mts
 *  Reads ONLY existing repo manifests (no network). Real durations only; private/dark/restricted rows are excluded.
 *  Writes: src/data/genre/<id>Catalog.json, reports/classic-network/genre-*.json, config/classic-networks.json (ajn247-* entries only). */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { readAppRows, episodeCode, episodeDisplayTitle, orderMovies, assertMovieCycle } from './build-classic-network-catalog.mts';
import type { NetworkAsset, NetworkCatalog, NetworkConfig } from '../server/classicNetwork';

type Row = Record<string, unknown>;
interface ShowSpec { slug: string; name: string; channel?: string; identifier?: string; file?: string; excludeFile?: string; requireCode?: boolean; reduced?: boolean; titleRx?: string; seqRx?: string }
interface TvSpec { id: string; name: string; pills: string[]; shows: ShowSpec[] }
interface MovieSpec { id: string; bucket: string; name: string; pills: string[] }
interface GenreConfig { activeFrom: string; seedSuffix: string; minEpisodeDepth: number; reducedWeightFactor: number; tv: TvSpec[]; movies: MovieSpec[]; movieRules: Record<string, string>; movieIdentifierRules: Record<string, string> }
export interface Exclusion { show: string; file: string; id: string; reason: string }

const cfg = JSON.parse(fs.readFileSync('config/genre-channels.json', 'utf8')) as GenreConfig;
const fileOf = (r: Row) => String(r.file ?? r.fileName ?? r.path ?? '');
const baseName = (f: string) => f.split('/').pop() ?? f;
const JUNK = /(trailer|sample|featurette|behind[ ._-]the[ ._-]scenes|bonus|\bextras?\b|interview|scrapbook|making[ ._-]of|promo)/i;
const MIN_SECONDS = 300, MAX_SECONDS = 9000; // 5 min .. 150 min: below = clip, above = feature film, never an episode

interface Order { season?: number; episode?: number; seq?: number }
/** Tier 1: SxxExx / NxNN / "Season N Episode N". Tier 2: "S01 - 07 - Title", "Ep. 01", "Episode 01", "EP01", leading "001." */
export function parseOrder(file: string, seqRx?: RegExp): Order {
  const code = episodeCode(file);
  if (code) return { season: code.season, episode: code.episode };
  const b = baseName(file);
  const custom = seqRx?.exec(b);
  if (custom) return { seq: Number(custom[1]) };
  const dw = /^S(\d{1,2})\s*-\s*(\d{1,3})\s*-/i.exec(b);
  if (dw) return { season: Number(dw[1]), episode: Number(dw[2]) };
  const ep = /(?:^|[\s._-])(?:Ep\.?|Episode|EP)[\s._-]*(\d{1,3})(?=\D|$)/.exec(b);
  if (ep) return { seq: Number(ep[1]) };
  const lead = /^(\d{1,4})[\s._-]/.exec(b);
  if (lead && !/^(?:19|20)\d\d$/.test(lead[1])) return { seq: Number(lead[1]) };
  return {};
}
const norm = (t: string) => t.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
const pad = (n: number, w: number) => String(n).padStart(w, '0');

const escapeRe = (w: string) => w.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
function titleFor(show: ShowSpec, file: string, o: Order): string {
  const code = o.season !== undefined ? `S${pad(o.season, 2)}E${pad(o.episode ?? 0, 2)}` : o.seq !== undefined ? `E${pad(o.seq, 2)}` : '';
  let extra = episodeDisplayTitle(file, '');
  const words = show.name.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean).slice(0, 3).map(escapeRe);
  if (words.length) extra = extra.replace(new RegExp(`^(?:the\\s+)?${words.join("[\\s._\\-']*")}[\\s._\\-']*`, 'i'), '');
  extra = extra.replace(/\bs\d{1,2}[\s._-]*e\d{1,3}(?:[\s._-]*e\d{1,3})?\b/i, '').replace(/\b\d{1,2}x\d{1,3}\b/i, '').replace(/\.(?:ia|h264)$/i, '')
    .replace(/^(?:ep\.?|episode)[\s._-]*\d{1,3}\b/i, '').replace(/^\d{1,4}[\s._-]+/, '').replace(/^[\s—–\-.:]+|[\s—–\-.:]+$/g, '').trim();
  return extra ? `${show.name} ${code} — ${extra}`.replace(/\s+/g, ' ').trim() : `${show.name} ${code}`.trim();
}

function buildTv(spec: TvSpec, rows: Row[]) {
  const excluded: Exclusion[] = [];
  const assets: NetworkAsset[] = [];
  const sortKey = new Map<string, [number, number, number, string]>();
  for (const show of spec.shows) {
    const ch = show.channel ? new RegExp(show.channel, 'i') : undefined, idr = show.identifier ? new RegExp(show.identifier, 'i') : undefined;
    const trx = show.titleRx ? new RegExp(show.titleRx, 'i') : undefined, srx = show.seqRx ? new RegExp(show.seqRx, 'i') : undefined;
    const fr = show.file ? new RegExp(show.file, 'i') : undefined, xr = show.excludeFile ? new RegExp(show.excludeFile, 'i') : undefined;
    const chosen = new Map<string, { asset: NetworkAsset; rank: number; bytes: number }>();
    for (const r of rows) {
      const file = fileOf(r), id = String(r.identifier ?? ''), chId = String(r.channelId ?? '');
      if (ch && !ch.test(chId)) continue;
      if (idr && !idr.test(id)) continue;
      if (fr && !fr.test(baseName(file))) continue;
      if (!ch && !idr && !fr) throw new Error(`${show.slug}: spec needs at least one of channel/identifier/file`);
      const ex = (reason: string) => excluded.push({ show: show.slug, file, id, reason });
      if (!/\.mp4$/i.test(file) || !id) { ex('no_mp4_or_identifier'); continue; }
      if (r.private || r.is_dark || r.restricted || r.durationEstimated === true) { ex('private_or_unverified_duration'); continue; }
      const duration = Number(r.durationSeconds);
      if (!Number.isFinite(duration) || duration <= 0) { ex('missing_real_duration'); continue; }
      if (duration < MIN_SECONDS || duration > MAX_SECONDS) { ex('outside_episode_runtime_5_150_min'); continue; }
      if (JUNK.test(baseName(file)) || (xr && xr.test(file))) { ex('extra_interview_or_non_episode'); continue; }
      const o = parseOrder(file, srx);
      let titleKey: string | undefined;
      if (trx) { const m = trx.exec(baseName(file)); if (!m || !m[1]) { ex('title_not_parsed'); continue; } titleKey = `${show.slug}:t:${norm(m[1])}`; }
      if (show.requireCode && o.season === undefined) { ex('no_season_episode_code'); continue; }
      const key = titleKey ?? (o.season !== undefined ? `${show.slug}:s${pad(o.season, 2)}e${pad(o.episode ?? 0, 3)}`
        : o.seq !== undefined ? `${show.slug}:o${pad(o.seq, 4)}` : `${show.slug}:t:${norm(episodeDisplayTitle(file, file))}`);
      const archivePath = `/download/${encodeURIComponent(id)}/${file.split('/').map(encodeURIComponent).join('/')}`;
      const asset: NetworkAsset = { episodeKey: key, assetId: String(r.id ?? `g247-${createHash('sha1').update(`${id}/${file}`).digest('hex').slice(0, 14)}`),
        show: show.slug, title: titleFor(show, file, o), archivePath, durationSeconds: Math.round(duration),
        ...(o.season !== undefined ? { season: o.season, episode: o.episode } : {}), sources: [chId || id] };
      const rank = /\.ia\.mp4$/i.test(file) || /h\.?264/i.test(String(r.format)) ? 0 : 1;
      const bytes = Number(r.bytes ?? r.sizeBytes ?? Number.MAX_SAFE_INTEGER);
      const old = chosen.get(key);
      if (!old) { chosen.set(key, { asset, rank, bytes }); sortKey.set(key, [o.season !== undefined ? 0 : o.seq !== undefined ? 1 : 2, o.season ?? 0, o.episode ?? o.seq ?? 0, baseName(file)]); continue; }
      const keepNew = rank < old.rank || (rank === old.rank && (bytes < old.bytes || (bytes === old.bytes && archivePath < old.asset.archivePath)));
      const sources = [...new Set([...old.asset.sources, ...asset.sources])].sort();
      if (keepNew) { ex('duplicate_episode_rendition'); chosen.set(key, { asset: { ...asset, sources }, rank, bytes }); } else { ex('duplicate_episode_rendition'); old.asset.sources = sources; }
    }
    const coll = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
    // 3-tier chronological order: (season, episode) -> (sequence) -> natural collation of file name; episodeKey is the final tie-break.
    const list = [...chosen.values()].map(v => v.asset).sort((a, b) => {
      const x = sortKey.get(a.episodeKey)!, y = sortKey.get(b.episodeKey)!;
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || coll.compare(x[3], y[3]) || a.episodeKey.localeCompare(b.episodeKey, 'en', { numeric: true });
    });
    assets.push(...list);
  }
  return { catalog: { schema: 1, assets } as NetworkCatalog, excluded };
}

const decodeSeg = (v: string) => { try { return decodeURIComponent(v); } catch { return v; } };
const movieText = (a: NetworkAsset) => `${a.title} ${decodeSeg(a.archivePath.split('/').pop() ?? '')}`;
const movieItem = (a: NetworkAsset) => decodeSeg(a.archivePath.split('/')[2] ?? '');
/** Order: manual override -> scifi-horror title words -> item/director hint -> action-western title words -> comedy-drama-noir title words -> triage. */
function buildMovies(overrides: Record<string, string>) {
  const all = (JSON.parse(fs.readFileSync('src/data/classicMoviesCatalog.json', 'utf8')) as NetworkCatalog).assets;
  const title = Object.fromEntries(Object.entries(cfg.movieRules).map(([b, src]) => [b, new RegExp(src, 'i')]));
  const item = Object.entries(cfg.movieIdentifierRules).map(([b, src]) => [b, new RegExp(src, 'i')] as const);
  const buckets = new Map<string, NetworkAsset[]>(cfg.movies.map(m => [m.bucket, []]));
  const triage: Array<{ episodeKey: string; title: string; item: string }> = [], excluded: Array<{ episodeKey: string; reason: string }> = [];
  const via: Record<string, number> = {};
  const put = (b: string, a: NetworkAsset, how: string) => { buckets.get(b)!.push(a); via[how] = (via[how] ?? 0) + 1; };
  for (const a of all) {
    if (a.durationSeconds < 3600 || a.durationSeconds > 14400) { excluded.push({ episodeKey: a.episodeKey, reason: 'outside_60_240_minutes' }); continue; }
    const ov = overrides[a.episodeKey];
    if (ov === 'exclude') { excluded.push({ episodeKey: a.episodeKey, reason: 'manual_override_exclude' }); continue; }
    if (ov && buckets.has(ov)) { put(ov, a, 'manual_override'); continue; }
    const text = movieText(a), id = movieItem(a);
    if (title['scifi-horror'].test(text)) { put('scifi-horror', a, 'title_scifi_horror'); continue; }
    const byItem = item.find(([, re]) => re.test(id));
    if (byItem) { put(byItem[0], a, 'item_or_director_hint'); continue; }
    if (title['action-western'].test(text)) { put('action-western', a, 'title_action_western'); continue; }
    if (title['comedy-drama-noir'].test(text)) { put('comedy-drama-noir', a, 'title_comedy_drama_noir'); continue; }
    triage.push({ episodeKey: a.episodeKey, title: a.title, item: id });
  }
  return { buckets, triage, excluded, total: all.length, via };
}

const rows = readAppRows();
const networks: Record<string, NetworkConfig> = {};
const summary: unknown[] = [];
fs.mkdirSync('src/data/genre', { recursive: true }); fs.mkdirSync('reports/classic-network', { recursive: true });
const write = (f: string, v: unknown) => fs.writeFileSync(f, `${JSON.stringify(v, null, 2)}\n`);
const common = { owner: 'banamine', lineup: [], pools: {}, activeFrom: cfg.activeFrom, minEpisodeDepth: cfg.minEpisodeDepth } as const;

for (const spec of cfg.tv) {
  const { catalog, excluded } = buildTv(spec, rows);
  const per = spec.shows.map(s => { const a = catalog.assets.filter(x => x.show === s.slug); const sec = a.reduce((t, x) => t + x.durationSeconds, 0); return { show: s.slug, distinctEpisodes: a.length, totalHours: Number((sec / 3600).toFixed(1)), meanMinutes: a.length ? Number((sec / a.length / 60).toFixed(1)) : 0, reducedWeight: !!s.reduced }; });
  const shallow = per.filter(p => p.distinctEpisodes < cfg.minEpisodeDepth);
  if (shallow.length) throw new Error(`${spec.id}: shows below ${cfg.minEpisodeDepth} verified episodes: ${shallow.map(s => `${s.show}=${s.distinctEpisodes}`).join(', ')}`);
  write(`src/data/genre/${spec.id}Catalog.json`, catalog);
  write(`reports/classic-network/genre-${spec.id}-exclusions.json`, { excluded, perShow: per });
  const caps = Object.fromEntries(spec.shows.filter(s => s.reduced).map(s => [s.slug, Math.floor(per.find(p => p.show === s.slug)!.distinctEpisodes * cfg.reducedWeightFactor)]));
  networks[spec.id] = { id: spec.id, name: spec.name, guideId: 'classic-tv', ...common, catalogRef: `src/data/genre/${spec.id}Catalog.json`, publicationRef: `src/data/genre/${spec.id}Publication.json`,
    schedulingMode: 'shuffle-in-order', showPool: spec.shows.map(s => s.slug), episodesPerTurn: 1, noBackToBackWindow: Math.min(3, spec.shows.length - 1),
    ...(Object.keys(caps).length ? { maxWeeklyAirings: caps } : {}), seed: `${spec.id}-${cfg.seedSuffix}` } as NetworkConfig;
  summary.push({ channel: spec.id, shows: per, excluded: excluded.length });
}

const ov = (JSON.parse(fs.readFileSync('config/movie-genre-overrides.json', 'utf8')) as { overrides: Record<string, string> }).overrides;
const mv = buildMovies(ov);
for (const spec of cfg.movies) {
  const seed = `${spec.id}-${cfg.seedSuffix}`;
  const assets = orderMovies(mv.buckets.get(spec.bucket)!, seed);
  const hours = assetsHours(assets);
  assertMovieCycle(assets);
  write(`src/data/genre/${spec.id}Catalog.json`, { schema: 1, assets } as NetworkCatalog);
  networks[spec.id] = { id: spec.id, name: spec.name, guideId: 'movies-classics-vault', ...common, catalogRef: `src/data/genre/${spec.id}Catalog.json`, publicationRef: `src/data/genre/${spec.id}Publication.json`,
    schedulingMode: 'random-movie', seed } as NetworkConfig;
  summary.push({ channel: spec.id, films: assets.length, hours });
}
function assetsHours(a: NetworkAsset[]) { return Number((a.reduce((t, x) => t + x.durationSeconds, 0) / 3600).toFixed(1)); }
write('reports/classic-network/genre-movie-triage.json', { sourceFilms: mv.total, classified: [...mv.buckets.values()].reduce((n, v) => n + v.length, 0), unclassified: mv.triage.length, excluded: mv.excluded.length, classifiedVia: mv.via, unclassifiedTitles: mv.triage });

const cfgPath = 'config/classic-networks.json';
const settings = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as { networks: Record<string, NetworkConfig> };
for (const k of Object.keys(settings.networks)) if (k.startsWith('ajn247-')) delete settings.networks[k];
Object.assign(settings.networks, networks);
write(cfgPath, settings);
console.log(JSON.stringify(summary, null, 1));
console.log(`movie triage: ${mv.triage.length} of ${mv.total} films unclassified (see reports/classic-network/genre-movie-triage.json)`);
