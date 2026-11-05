// Offline compiler shared by the Classic TV and Movies networks. No network or disk I/O.
import { createHash } from 'node:crypto';
import type { Program } from '../src/types';

export const COMPILER_VERSION = 'classic-network-1';
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
export interface NetworkConfig {
  id: string; name: string; guideId: string; owner: string; catalogRef: string;
  lineup: Lane[]; pools: Record<string, Pool>;
  includeChannels?: string[]; seed?: string;
}
export interface NetworkSettings {
  stationZone: string; originMonday: string; horizonDays: number; activeFrom: string;
  repeatGapHours: number; networks: Record<string, NetworkConfig>;
}
export interface StartRecord { episodeKey: string; start: number }
export interface Checkpoint {
  cursors: Record<string, number>; starts: StartRecord[]; carryOver: Program | null;
  inputHash: string; compilerHash: string; nextUncompiledInstant: number;
}
export interface Publication {
  schema: 1; networkId: string; revision: string; compilerVersion: string;
  stationZone: string; tzdbNote?: string; originMonday: string; repeatGapHours: number;
  activeFrom: string; coveredUntilUtcMs: number; programs: Program[];
  checkpoint: Checkpoint; missedLaneLog: Array<{ start: number; pool: string }>;
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
export function compileNetwork(settings: NetworkSettings, n: NetworkConfig, catalog: NetworkCatalog, previous?: Publication): Publication {
  validateLineup(n);
  if (settings.repeatGapHours !== 168 || !Number.isInteger(settings.horizonDays) || settings.horizonDays < 1 || settings.horizonDays > 60) throw new Error('Invalid repeat gap/horizon');
  if (new Date(`${settings.originMonday}T00:00Z`).getUTCDay() !== 1) throw new Error('Origin must be Monday');
  const start = parseActivation(settings.activeFrom, settings.stationZone);
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
  while (now < end) {
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
    schema: 1, networkId: n.id, revision: '', compilerVersion: COMPILER_VERSION,
    stationZone: settings.stationZone, tzdbNote: `Intl tzdb ${process.versions.tz ?? 'runtime supplied'}; Node ${process.versions.node}`,
    originMonday: settings.originMonday, repeatGapHours: settings.repeatGapHours,
    activeFrom: new Date(start).toISOString(), coveredUntilUtcMs: now, programs,
    checkpoint: { cursors, starts: starts.filter(s => s.start >= now - gap), carryOver: programs.at(-1) ?? null,
      inputHash: digest({ catalog, n, zone: settings.stationZone, origin: settings.originMonday }),
      compilerHash: digest(COMPILER_VERSION), nextUncompiledInstant: now },
    missedLaneLog,
  };
  pub.revision = publicationHash(pub);
  for (const program of programs) if (Date.parse(program.startTimeUtc!) >= start) program.metadata!.scheduleRevision = pub.revision;
  if (pub.checkpoint.carryOver) pub.checkpoint.carryOver = programs.at(-1)!;
  return pub;
}
