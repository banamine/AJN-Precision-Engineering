// Offline compiler shared by the Classic TV and Movies networks. No network or disk I/O.
import { createHash } from 'node:crypto';
import type { Program } from '../src/types';

export const COMPILER_VERSION = 'classic-network-1';
/** Stamped on publications compiled in 'shuffle-in-order' / 'random-movie' mode. 'lanes' output keeps COMPILER_VERSION byte-for-byte. */
export const COMPILER_VERSION_V2 = 'classic-network-2';
export const HOUR = 3_600_000;
export interface NetworkAsset {
  episodeKey: string;
  assetId: string;
  show: string;
  title: string;
  archivePath: string;
  durationSeconds: number;
  season?: number;
  episode?: number;
  sources: string[];
}
export interface NetworkCatalog { schema: 1; assets: NetworkAsset[] }
export interface Lane { start: string; end: string; pool: string }
export interface Pool { series: string[]; rotateEveryWeeks: number; offset: number }
export type SchedulingMode = 'lanes' | 'shuffle-in-order' | 'random-movie';
export interface NetworkConfig {
  id: string; name: string; guideId: string; owner: string; catalogRef: string;
  lineup: Lane[]; pools: Record<string, Pool>;
  includeChannels?: string[]; seed?: string;
  /** Default 'lanes' (time-block lineup, unchanged). */
  schedulingMode?: SchedulingMode;
  /** Own publication artifact and activation (new modes). Existing networks keep the file map in tools/compile-classic-network.mts. */
  publicationRef?: string; activeFrom?: string;
  /** shuffle-in-order: series slugs, one episode per turn. */
  showPool?: string[]; episodesPerTurn?: 1;
  /** Default Math.min(3, showPool.length - 1). Relaxed 3->2->1->0 only when no show is otherwise eligible. */
  noBackToBackWindow?: number;
  /** Per-show cap on airings inside any rolling 168h window (reduced-weight shows). */
  maxWeeklyAirings?: Record<string, number>;
  /** Minimum distinct verified episodes per pooled show. Default 30. */
  minEpisodeDepth?: number;
}
export interface NetworkSettings {
  stationZone: string; originMonday: string; horizonDays: number; activeFrom: string;
  repeatGapHours: number; networks: Record<string, NetworkConfig>;
}
export interface StartRecord { episodeKey: string; start: number }
export interface Checkpoint {
  cursors: Record<string, number>; starts: StartRecord[]; carryOver: Program | null;
  inputHash: string; compilerHash: string; nextUncompiledInstant: number;
  /** New modes only: resume state so --previous renewal continues on the exact next turn / episode / movie cycle. */
  turnIndex?: number; recentShows?: string[]; cycleIndex?: number;
}
export interface RuleRelaxation { turn: number; start: number; window: number }
export interface Diagnostics { mode: SchedulingMode; ruleRelaxations: number; relaxationLog: RuleRelaxation[] }
export interface Publication {
  schema: 1; networkId: string; revision: string; compilerVersion: string;
  stationZone: string; tzdbNote?: string; originMonday: string; repeatGapHours: number;
  activeFrom: string; coveredUntilUtcMs: number; programs: Program[];
  checkpoint: Checkpoint; missedLaneLog: Array<{ start: number; pool: string }>;
  diagnostics?: Diagnostics;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
export function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export function publicationHash(p: Publication): string {
  const { revision: _revision, tzdbNote: _tzdbNote, ...body } = p;
  // Revision and environment-specific diagnostic notes are not content identity.
  const clean = JSON.parse(JSON.stringify(body), (k: string, v: unknown) => k === 'scheduleRevision' ? undefined : v) as unknown;
  return digest(clean);
}
const formatters = new Map<string, Intl.DateTimeFormat>();
export function zonedParts(ms: number, zone: string): Record<string, number> {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    formatters.set(zone, f);
  }
  return Object.fromEntries(f.formatToParts(ms).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
}
export function dateKey(ms: number, zone: string): string {
  const p = zonedParts(ms, zone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 24 * HOUR).toISOString().slice(0, 10);
}
export function localInstant(day: string, time: string, zone: string): number {
  if (!/^\d{4}-\d\d-\d\d$/.test(day) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error(`Invalid local time ${day} ${time}`);
  const base = Date.parse(`${day}T${time}:00Z`);
  if (!Number.isFinite(base) || new Date(base).toISOString().slice(0, 10) !== day) throw new Error('Invalid calendar date');
  const offsets = new Set<number>();
  for (let h = -36; h <= 36; h += 6) {
    const t = base + h * HOUR, p = zonedParts(t, zone);
    offsets.add(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - t);
  }
  const matches = [...offsets].map(offset => base - offset).filter(t => {
    const p = zonedParts(t, zone);
    return dateKey(t, zone) === day && `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}` === time;
  });
  if (matches.length !== 1) throw new Error(`Ambiguous/nonexistent local time ${day} ${time} ${zone}`);
  return matches[0];
}
export function parseActivation(text: string, zone: string): number {
  if (text.endsWith(` ${zone}`)) {
    const local = text.slice(0, -(zone.length + 1));
    return localInstant(local.slice(0, 10), local.slice(11, 16), zone);
  }
  const n = Date.parse(text);
  if (!Number.isFinite(n)) throw new Error('Invalid activation instant');
  return n;
}
export function dayBounds(day: string, zone: string): [number, number] {
  return [localInstant(day, '00:00', zone), localInstant(addDays(day, 1), '00:00', zone)];
}
const minutes = (t: string) => {
  if (t === '24:00') return 1440;
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t)) throw new Error(`Invalid boundary ${t}`);
  const [h, m] = t.split(':').map(Number); return h * 60 + m;
};
export function validateLineup(n: NetworkConfig): void {
  let end = 0;
  for (const lane of n.lineup) {
    const s = minutes(lane.start), e = minutes(lane.end);
    if (s !== end || e <= s || [s, e].some(v => v >= 60 && v < 180)) throw new Error(`Invalid lane boundary ${lane.start}-${lane.end}`);
    const p = n.pools[lane.pool];
    if (!p || !p.series.length || !Number.isInteger(p.rotateEveryWeeks) || p.rotateEveryWeeks < 1 || !Number.isInteger(p.offset)) throw new Error(`Empty/invalid pool ${lane.pool}`);
    end = e;
  }
  if (end !== 1440) throw new Error('Lineup must cover the station day');
}
export function poolSeries(pool: Pool, day: string, origin: string): string {
  const days = (Date.parse(`${day}T00:00Z`) - Date.parse(`${origin}T00:00Z`)) / (24 * HOUR);
  if (days < 0) throw new Error(`Date ${day} precedes origin ${origin}`);
  if (!pool.series.length) throw new Error('Empty pool');
  const i = Math.floor(Math.floor(days / 7) / pool.rotateEveryWeeks) + pool.offset;
  return pool.series[((i % pool.series.length) + pool.series.length) % pool.series.length];
}
export function assertRepeat(starts: readonly StartRecord[], gapMs: number): void {
  const last = new Map<string, number>();
  for (const s of starts) {
    const old = last.get(s.episodeKey);
    if (old !== undefined && s.start - old < gapMs) throw new Error(`168h gate: ${s.episodeKey} window ${new Date(old).toISOString()}..${new Date(s.start).toISOString()} gap=${s.start - old}ms required=${gapMs}ms`);
    last.set(s.episodeKey, s.start);
  }
}

/* ---------- new scheduling modes (shuffle-in-order, random-movie) ---------- */
const showOfKey = (key: string) => key.split(':')[0];
/** SHA-256(`${seed}:${label}`) -> first 8 bytes as unsigned 64-bit BigInt -> modulo n. Deterministic, no Math.random. */
export function seededIndex(seed: string, label: string, n: number): number {
  if (!(n > 0)) throw new Error('seededIndex needs n > 0');
  return Number(createHash('sha256').update(`${seed}:${label}`).digest().readBigUInt64BE(0) % BigInt(n));
}
function genreProgram(settings: NetworkSettings, n: NetworkConfig, asset: NetworkAsset, series: string, now: number, finish: number): Program {
  const occurrenceId = `cn1:${n.id}:${asset.episodeKey}:${now}`;
  return {
    id: occurrenceId, assetId: asset.assetId, guideId: n.guideId, channelId: n.id,
    title: asset.title, startTime: 0, endTime: asset.durationSeconds / 3600,
    startTimeUtc: new Date(now).toISOString(), endTimeUtc: new Date(finish).toISOString(),
    mediaType: 'video', mediaUrl: asset.archivePath, archivePath: asset.archivePath,
    sourceClass: 'archive_org', isArchivedSource: true,
    metadata: { epg: 'utc', scheduledVod: true, stationZone: settings.stationZone,
      episodeKey: asset.episodeKey, assetId: asset.assetId, occurrenceId, show: series,
      ...(asset.season === undefined ? {} : { season: asset.season, episode: asset.episode }),
      durationSeconds: asset.durationSeconds },
  };
}
interface GenreCtx {
  settings: NetworkSettings; n: NetworkConfig; byShow: Map<string, NetworkAsset[]>; programs: Program[];
  cursors: Record<string, number>; starts: StartRecord[]; gap: number; end: number; now: number;
}
interface GenreResult { now: number; relaxationLog: RuleRelaxation[]; turnIndex: number; recentShows: string[]; cycleIndex?: number }
const iso = (ms: number) => new Date(ms).toISOString();

function compileShuffleInOrder(c: GenreCtx): GenreResult {
  const { settings, n, byShow, programs, cursors, gap, end } = c;
  let { now } = c;
  const pool = n.showPool ?? [];
  if (!pool.length || new Set(pool).size !== pool.length) throw new Error(`${n.id}: showPool must be a non-empty list of unique series`);
  if (!n.seed) throw new Error(`${n.id}: shuffle-in-order requires a seed`);
  if ((n.episodesPerTurn ?? 1) !== 1) throw new Error(`${n.id}: episodesPerTurn must be exactly 1`);
  const minDepth = n.minEpisodeDepth ?? 30;
  for (const show of pool) {
    const depth = byShow.get(show)?.length ?? 0;
    if (depth < minDepth) throw new Error(`${n.id}: ${show} has ${depth} verified episodes (< ${minDepth}); replace it or lower minEpisodeDepth deliberately`);
  }
  const baseWindow = Math.max(0, Math.min(n.noBackToBackWindow ?? Math.min(3, pool.length - 1), pool.length - 1));
  let turn = programs.length;
  const recent: string[] = programs.slice(-Math.max(baseWindow, 1)).map(p => String(p.metadata?.show));
  const starts = c.starts;
  const relaxationLog: RuleRelaxation[] = [];
  while (now < end) {
    const live = starts.filter(s => s.start > now - gap);
    starts.splice(0, starts.length, ...live);
    const lastStart = new Map<string, number>();
    for (const s of live) lastStart.set(s.episodeKey, s.start);
    const weekly = new Map<string, number>();
    for (const s of live) weekly.set(showOfKey(s.episodeKey), (weekly.get(showOfKey(s.episodeKey)) ?? 0) + 1);
    const eligibleFor = (blocked: Set<string>) => pool.filter(show => {
      if (blocked.has(show)) return false;
      const assets = byShow.get(show)!;
      const asset = assets[(cursors[show] ?? 0) % assets.length];
      const last = lastStart.get(asset.episodeKey);
      if (last !== undefined && now - last < gap) return false; // 168h gate is never relaxed
      const cap = n.maxWeeklyAirings?.[show];
      return cap === undefined || (weekly.get(show) ?? 0) < cap;
    });
    let window = baseWindow, eligible: string[] = [];
    for (; window >= 0; window--) {
      eligible = eligibleFor(new Set(window > 0 ? recent.slice(-window) : []));
      if (eligible.length) break;
    }
    if (!eligible.length) {
      const states = pool.map(show => {
        const assets = byShow.get(show)!, cursor = cursors[show] ?? 0, asset = assets[cursor % assets.length];
        const last = lastStart.get(asset.episodeKey);
        return { show, cursor, nextEpisode: asset.episodeKey, lastAiredUtc: last === undefined ? null : iso(last),
          remainingCooldownMs: last === undefined ? 0 : Math.max(0, gap - (now - last)), airingsInWindow: weekly.get(show) ?? 0, cap: n.maxWeeklyAirings?.[show] ?? null };
      });
      throw new Error(`shuffle-in-order exhausted: networkId=${n.id} turnIndex=${turn} nowUtc=${iso(now)} states=${JSON.stringify(states)}`);
    }
    if (window < baseWindow) relaxationLog.push({ turn, start: now, window });
    const series = eligible[seededIndex(n.seed, String(turn), eligible.length)];
    const assets = byShow.get(series)!, cursor = cursors[series] ?? 0, asset = assets[cursor % assets.length];
    const finish = now + Math.round(asset.durationSeconds * 1000);
    if (finish <= now) throw new Error('Invalid duration');
    assertRepeat([...live, { episodeKey: asset.episodeKey, start: now }], gap);
    starts.push({ episodeKey: asset.episodeKey, start: now });
    programs.push(genreProgram(settings, n, asset, series, now, finish));
    cursors[series] = cursor + 1; recent.push(series); if (recent.length > 8) recent.shift();
    now = finish; turn++;
  }
  return { now, relaxationLog, turnIndex: turn, recentShows: recent.slice(-Math.max(baseWindow, 1)) };
}

function compileRandomMovie(c: GenreCtx): GenreResult {
  const { settings, n, byShow, programs, gap, end } = c;
  let { now } = c;
  if (!n.seed) throw new Error(`${n.id}: random-movie requires a seed`);
  const assets = byShow.get('movies') ?? [];
  if (!assets.length) throw new Error(`${n.id}: empty movie catalog`);
  if (assets.some(a => a.durationSeconds < 3600 || a.durationSeconds > 14400)) throw new Error(`${n.id}: movie outside 60-240 minutes`);
  if (assets.reduce((t, a) => t + a.durationSeconds, 0) <= 168 * 3600) throw new Error(`${n.id}: movie cycle must exceed 168 real hours`);
  const L = assets.length;
  let picked = programs.length, cycle = Math.floor(picked / L);
  const doneInCycle = new Set(programs.slice(picked - (picked % L)).map(p => String(p.metadata?.episodeKey)));
  let remaining = assets.filter(a => !doneInCycle.has(a.episodeKey));
  if (!remaining.length) { remaining = [...assets]; cycle++; }
  const starts = c.starts;
  while (now < end) {
    const live = starts.filter(s => s.start > now - gap);
    starts.splice(0, starts.length, ...live);
    const lastStart = new Map<string, number>(live.map(s => [s.episodeKey, s.start]));
    // Seam guard: a film that aired < 168h ago is not eligible, so cycle N -> N+1 can never replay it inside the gate.
    const eligible = remaining.filter(a => { const l = lastStart.get(a.episodeKey); return l === undefined || now - l >= gap; });
    if (!eligible.length) throw new Error(`random-movie exhausted: networkId=${n.id} cycle=${cycle} remaining=${remaining.length} nowUtc=${iso(now)}`);
    const asset = eligible[seededIndex(n.seed, `cycle:${cycle}:${L - remaining.length}`, eligible.length)];
    const finish = now + Math.round(asset.durationSeconds * 1000);
    assertRepeat([...live, { episodeKey: asset.episodeKey, start: now }], gap);
    starts.push({ episodeKey: asset.episodeKey, start: now });
    programs.push(genreProgram(settings, n, asset, 'movies', now, finish));
    remaining = remaining.filter(a => a !== asset); picked++;
    if (!remaining.length) { remaining = [...assets]; cycle++; }
    now = finish;
  }
  return { now, relaxationLog: [], turnIndex: picked, recentShows: [], cycleIndex: cycle };
}

/** Per-network evidence (Phase 3): cycle length, repeat gaps, airings per show per 24h, first-time episodes, rule relaxations. */
export function evidenceReport(pub: Publication, catalog: NetworkCatalog, n: NetworkConfig) {
  const byShow = new Map<string, NetworkAsset[]>();
  for (const a of catalog.assets) { const l = byShow.get(a.show) ?? []; l.push(a); byShow.set(a.show, l); }
  const start = Date.parse(pub.activeFrom), days = (pub.coveredUntilUtcMs - start) / (24 * HOUR);
  const last = new Map<string, number>(); let minGap = Infinity, maxGap = 0;
  const counts = new Map<string, number>();
  for (const p of pub.programs) {
    const t = Date.parse(p.startTimeUtc!), k = String(p.metadata?.episodeKey), show = String(p.metadata?.show);
    counts.set(show, (counts.get(show) ?? 0) + 1);
    const o = last.get(k); if (o !== undefined) { minGap = Math.min(minGap, t - o); maxGap = Math.max(maxGap, t - o); } last.set(k, t);
  }
  const pool = n.showPool ?? [...byShow.keys()];
  const cycleSeconds = n.schedulingMode === 'random-movie' ? catalog.assets.reduce((s, a) => s + a.durationSeconds, 0)
    : pool.reduce((s, show) => { const a = byShow.get(show) ?? []; return s + (a.length ? a.reduce((t, x) => t + x.durationSeconds, 0) / a.length : 0); }, 0);
  return {
    networkId: n.id, mode: n.schedulingMode ?? 'lanes', revision: pub.revision, programs: pub.programs.length, coverageDays: Number(days.toFixed(2)),
    cycleHours: Number((cycleSeconds / 3600).toFixed(2)), showsInPool: n.schedulingMode === 'random-movie' ? undefined : pool.length,
    filmsInPool: n.schedulingMode === 'random-movie' ? catalog.assets.length : undefined,
    minGapHours: Number.isFinite(minGap) ? Number((minGap / HOUR).toFixed(3)) : null, maxGapHours: maxGap ? Number((maxGap / HOUR).toFixed(3)) : null,
    airingsPerShowPer24h: Object.fromEntries([...counts].sort().map(([show, c]) => [show, Number((c / days).toFixed(2))])),
    episodesPerShow: Object.fromEntries(pool.map(show => [show, byShow.get(show)?.length ?? 0])),
    firstTimeEpisodesAired: last.size, ruleRelaxations: pub.diagnostics?.ruleRelaxations ?? 0,
    ruleRelaxationLog: (pub.diagnostics?.relaxationLog ?? []).slice(0, 50),
  };
}

export function compileNetwork(settings: NetworkSettings, n: NetworkConfig, catalog: NetworkCatalog, previous?: Publication): Publication {
  const mode: SchedulingMode = n.schedulingMode ?? 'lanes';
  if (mode === 'lanes') validateLineup(n);
  if (settings.repeatGapHours !== 168 || !Number.isInteger(settings.horizonDays) || settings.horizonDays < 1 || settings.horizonDays > 60) throw new Error('Invalid repeat gap/horizon');
  if (new Date(`${settings.originMonday}T00:00Z`).getUTCDay() !== 1) throw new Error('Origin must be Monday');
  const start = parseActivation(n.activeFrom ?? settings.activeFrom, settings.stationZone);
  if (dateKey(start, settings.stationZone) < settings.originMonday) throw new Error('Activation precedes origin; choose an explicit future activation, never backdate');
  const end = localInstant(addDays(dateKey(start, settings.stationZone), settings.horizonDays), '00:00', settings.stationZone);
  const programs: Program[] = [];
  const cursors: Record<string, number> = {};
  const starts: StartRecord[] = [];
  const gap = settings.repeatGapHours * HOUR;
  let now = start;
  if (previous) {
    if (previous.networkId !== n.id || previous.stationZone !== settings.stationZone || previous.originMonday !== settings.originMonday ||
        previous.repeatGapHours !== settings.repeatGapHours || previous.revision !== publicationHash(previous))
      throw new Error('Prior publication identity/zone/origin/policy/hash mismatch');
    if (start <= Date.parse(previous.activeFrom) || start > previous.coveredUntilUtcMs) throw new Error('Backdating or unseeded publication seam');
    // Reconstruct recent starts from the approved prefix, including removed assets.
    for (const p of previous.programs) {
      if (Date.parse(p.startTimeUtc!) >= start) break;
      programs.push(p);
      const show = String(p.metadata?.show), key = String(p.metadata?.episodeKey);
      cursors[show] = (cursors[show] ?? 0) + 1;
      if (Date.parse(p.startTimeUtc!) >= start - gap) starts.push({ episodeKey: key, start: Date.parse(p.startTimeUtc!) });
      now = Date.parse(p.endTimeUtc!);
    }
    if (now < start) throw new Error('Publication prefix does not cover activation');
  }
  const byShow = new Map<string, NetworkAsset[]>();
  for (const asset of catalog.assets) {
    if (!(asset.durationSeconds > 0) || !Number.isFinite(asset.durationSeconds)) throw new Error(`Missing duration ${asset.episodeKey}`);
    const list = byShow.get(asset.show) ?? []; list.push(asset); byShow.set(asset.show, list);
  }
  if (previous && previous.checkpoint.inputHash !== digest({ catalog, n, zone: settings.stationZone, origin: settings.originMonday })) {
    for (const [show, assets] of byShow) {
      const last = [...programs].reverse().find(p => p.metadata?.show === show);
      if (!last) { cursors[show] = 0; continue; }
      const index = assets.findIndex(a => a.episodeKey === last.metadata?.episodeKey);
      if (index >= 0) { cursors[show] = index + 1; continue; }
      // If the previous asset was removed, retain the next still-admitted asset
      // from the approved future order. Never silently reset a returning series.
      const next = previous.programs.find(p => Date.parse(p.startTimeUtc!) >= start && p.metadata?.show === show &&
        assets.some(a => a.episodeKey === p.metadata?.episodeKey));
      if (!next) throw new Error(`Cannot migrate cursor for ${show}: no retained anchor`);
      cursors[show] = assets.findIndex(a => a.episodeKey === next.metadata?.episodeKey);
    }
  }
  const missedLaneLog: Publication['missedLaneLog'] = previous?.missedLaneLog.filter(l => l.start < start) ?? [];
  let genre: GenreResult | undefined;
  if (mode !== 'lanes') {
    const ctx: GenreCtx = { settings, n, byShow, programs, cursors, starts, gap, end, now };
    genre = mode === 'shuffle-in-order' ? compileShuffleInOrder(ctx) : compileRandomMovie(ctx);
    now = genre.now;
  }
  while (mode === 'lanes' && now < end) {
    const day = dateKey(now, settings.stationZone), p = zonedParts(now, settings.stationZone);
    const lane = n.lineup.find(l => minutes(l.start) <= p.hour * 60 + p.minute && minutes(l.end) > p.hour * 60 + p.minute);
    if (!lane) throw new Error(`No lane at ${now}`);
    const series = poolSeries(n.pools[lane.pool], day, settings.originMonday);
    const assets = byShow.get(series);
    if (!assets?.length) throw new Error(`Empty catalog for ${series}`);
    const cursor = cursors[series] ?? 0, asset = assets[cursor % assets.length];
    const finish = now + Math.round(asset.durationSeconds * 1000);
    if (finish <= now) throw new Error('Invalid duration');
    const recent = starts.filter(s => s.start > now - gap);
    assertRepeat([...recent, { episodeKey: asset.episodeKey, start: now }], gap);
    starts.splice(0, starts.length, ...recent, { episodeKey: asset.episodeKey, start: now });
    const occurrenceId = `cn1:${n.id}:${asset.episodeKey}:${now}`;
    const program: Program = {
      id: occurrenceId, assetId: asset.assetId, guideId: n.guideId, channelId: n.id,
      title: asset.title, startTime: 0, endTime: asset.durationSeconds / 3600,
      startTimeUtc: new Date(now).toISOString(), endTimeUtc: new Date(finish).toISOString(),
      mediaType: 'video', mediaUrl: asset.archivePath, archivePath: asset.archivePath,
      sourceClass: 'archive_org', isArchivedSource: true,
      metadata: { epg: 'utc', scheduledVod: true, stationZone: settings.stationZone,
        episodeKey: asset.episodeKey, assetId: asset.assetId, occurrenceId, show: series,
        ...(asset.season === undefined ? {} : { season: asset.season, episode: asset.episode }),
        durationSeconds: asset.durationSeconds },
    };
    programs.push(program); cursors[series] = cursor + 1;
    // A fully elapsed opportunity is reported, never filled or backdated.
    for (let d = day; d <= dateKey(finish, settings.stationZone); d = addDays(d, 1)) {
      for (const l of n.lineup) {
        const s = localInstant(d, l.start, settings.stationZone);
        const e = l.end === '24:00' ? dayBounds(d, settings.stationZone)[1] : localInstant(d, l.end, settings.stationZone);
        if (s > now && e <= finish) missedLaneLog.push({ start: s, pool: l.pool });
      }
    }
    now = finish;
  }
  const pub: Publication = {
    schema: 1, networkId: n.id, revision: '', compilerVersion: mode === 'lanes' ? COMPILER_VERSION : COMPILER_VERSION_V2,
    stationZone: settings.stationZone, tzdbNote: `Intl tzdb ${process.versions.tz ?? 'runtime supplied'}; Node ${process.versions.node}`,
    originMonday: settings.originMonday, repeatGapHours: settings.repeatGapHours,
    activeFrom: new Date(start).toISOString(), coveredUntilUtcMs: now, programs,
    checkpoint: { cursors, starts: starts.filter(s => s.start >= now - gap), carryOver: programs.at(-1) ?? null,
      inputHash: digest({ catalog, n, zone: settings.stationZone, origin: settings.originMonday }),
      compilerHash: digest(mode === 'lanes' ? COMPILER_VERSION : COMPILER_VERSION_V2), nextUncompiledInstant: now,
      ...(genre ? { turnIndex: genre.turnIndex, recentShows: genre.recentShows, ...(genre.cycleIndex === undefined ? {} : { cycleIndex: genre.cycleIndex }) } : {}) },
    missedLaneLog,
    ...(genre ? { diagnostics: { mode, ruleRelaxations: genre.relaxationLog.length, relaxationLog: genre.relaxationLog.slice(0, 200) } } : {}),
  };
  pub.revision = publicationHash(pub);
  for (const program of programs) if (Date.parse(program.startTimeUtc!) >= start) program.metadata!.scheduleRevision = pub.revision;
  if (pub.checkpoint.carryOver) pub.checkpoint.carryOver = programs.at(-1)!;
  return pub;
}
