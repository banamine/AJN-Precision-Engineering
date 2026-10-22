import type { Program, ScheduleChannel } from '../src/types';
import { normalizeAssetIdentity, normalizeProgramIdentity } from '../src/utils/epgIdentity';
import { parseAllMyChildrenFileName, allMyChildrenWeekday, type AllMyChildrenPart } from './allmychildren-parse';
import { toProgram, type ShowSourceRow } from '../src/services/producers/showSourcesProducer';

export interface AllMyChildrenManifestRow {
  id: string;
  identifier: string;
  file: string;
  title: string;
  bytes: number;
  durationSeconds: number;
  thumb: string | null;
}

export interface AllMyChildrenManifestChannel {
  guideId: string;
  id: string;
  name: string;
  group: string;
  rows: AllMyChildrenManifestRow[];
}

interface Candidate {
  row: AllMyChildrenManifestRow;
  part: AllMyChildrenPart | null;
  kind: string;
  airDate: string;
  episode: number;
}

interface PlaySegment {
  id: string;
  archivePath: string;
  identifier: string;
  file: string;
  durationSeconds: number;
  bytes: number;
  part: AllMyChildrenPart | null;
}

const EPISODES_ID = 'ajn-allmychildren-episodes';
const EXTRAS_ID = 'ajn-allmychildren-extras';
const SERIES_KEY = 'all-my-children';
const EXPLICIT_EXTRA_KINDS = new Set(['promo', 'clip', 'recap', 'compilation', 'credits']);
const isRemoveBundle = (row: AllMyChildrenManifestRow) => row.identifier.toLowerCase().includes('1984remove');
const compareSource = (a: AllMyChildrenManifestRow, b: AllMyChildrenManifestRow) =>
  Number(isRemoveBundle(a)) - Number(isRemoveBundle(b))
  || a.identifier.localeCompare(b.identifier)
  || a.file.localeCompare(b.file);
const comparePart = (a: Candidate, b: Candidate) =>
  (a.part?.number ?? Number.MAX_SAFE_INTEGER) - (b.part?.number ?? Number.MAX_SAFE_INTEGER)
  || Number(a.part?.variant === 'b') - Number(b.part?.variant === 'b')
  || compareSource(a.row, b.row);

function archivePath(row: AllMyChildrenManifestRow): string {
  return `/download/${row.identifier}/${row.file.split('/').map(encodeURIComponent).join('/')}`;
}

function archiveRow(row: AllMyChildrenManifestRow, channelId: string, channelName: string): ShowSourceRow {
  return { ...row, channelId, channelName, series: 'All My Children' };
}

function airDateLabel(airDate: string): string {
  const [year, month, day] = airDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = allMyChildrenWeekday(airDate);
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(date);
  return `${weekday}, ${monthName} ${day}, ${year}`;
}

function parseEpisodeCandidate(row: AllMyChildrenManifestRow): Candidate | null {
  if (!(row.bytes > 0) || !(row.durationSeconds >= 10)) return null;
  const parsed = parseAllMyChildrenFileName(row.file, row.durationSeconds);
  if (!parsed.date || parsed.episode === null || (parsed.kind !== 'full' && parsed.kind !== 'part')) return null;
  return { row, part: parsed.part, kind: parsed.kind, airDate: parsed.date, episode: parsed.episode };
}

function segmentFor(candidate: Candidate, parentProgramId: string): PlaySegment {
  const path = archivePath(candidate.row);
  return {
    // PlayerView locates the parent schedule program by this stable id, then the current
    // segment by path. Keeping the parent id lets segment auto-advance continue.
    id: parentProgramId,
    archivePath: path,
    identifier: candidate.row.identifier,
    file: candidate.row.file,
    durationSeconds: candidate.row.durationSeconds,
    bytes: candidate.row.bytes,
    part: candidate.part,
  };
}

function makeEpisodeProgram(candidates: Candidate[], channel: AllMyChildrenManifestChannel): Program {
  const sorted = [...candidates].sort(comparePart);
  const full = sorted.filter((candidate) => candidate.kind === 'full').sort((a, b) => compareSource(a.row, b.row));
  const chosen: Candidate[] = [];
  const alternates: Candidate[] = [];
  if (full.length) {
    chosen.push(full[0]);
    alternates.push(...full.slice(1), ...sorted.filter((candidate) => candidate.kind !== 'full'));
  } else {
    const byPart = new Map<number, Candidate[]>();
    const unnumbered: Candidate[] = [];
    for (const candidate of sorted) {
      if (candidate.part) {
        const options = byPart.get(candidate.part.number) ?? [];
        options.push(candidate);
        byPart.set(candidate.part.number, options);
      } else {
        unnumbered.push(candidate);
      }
    }
    for (const options of byPart.values()) {
      options.sort((a, b) =>
        Number(a.part?.variant === 'b') - Number(b.part?.variant === 'b')
        || compareSource(a.row, b.row));
      chosen.push(options[0]);
      alternates.push(...options.slice(1));
    }
    unnumbered.sort((a, b) => compareSource(a.row, b.row));
    if (!chosen.length && unnumbered.length) chosen.push(unnumbered.shift()!);
    alternates.push(...unnumbered);
    chosen.sort(comparePart);
  }

  const first = chosen[0];
  const airDate = first.airDate;
  const episode = first.episode;
  const dateLabel = airDateLabel(airDate);
  const title = `All My Children - ${dateLabel} - Ep ${episode}`;
  const externalId = `${SERIES_KEY}:${airDate}:ep${episode}`;
  const programId = normalizeProgramIdentity({ externalId, channelId: channel.id, title, startTime: 0 });
  const base = toProgram(archiveRow(first.row, channel.id, channel.name), channel.guideId);
  const segments = chosen.map((candidate) => segmentFor(candidate, programId));
  const alternateRows = alternates.map((candidate) => ({
    id: candidate.row.id,
    identifier: candidate.row.identifier,
    file: candidate.row.file,
    archivePath: archivePath(candidate.row),
    durationSeconds: candidate.row.durationSeconds,
    bytes: candidate.row.bytes,
    part: candidate.part,
  }));
  const subtitle = parseAllMyChildrenFileName(first.row.file, first.row.durationSeconds).subtitle;
  const searchTerms = [...new Set([
    airDate,
    ...candidates
      .map((candidate) => parseAllMyChildrenFileName(candidate.row.file, candidate.row.durationSeconds).subtitle)
      .filter((candidateSubtitle): candidateSubtitle is string => Boolean(candidateSubtitle)),
  ])];
  const durationSeconds = chosen.reduce((sum, candidate) => sum + candidate.row.durationSeconds, 0);

  return {
    ...base,
    id: programId,
    title,
    description: 'All My Children',
    startTime: 0,
    endTime: 0,
    assetId: normalizeAssetIdentity({ externalId: first.row.id, mediaUrl: base.archivePath }),
    metadata: {
      externalId,
      archiveIdentifier: first.row.identifier,
      file: first.row.file,
      series: 'All My Children',
      seriesKey: SERIES_KEY,
      seriesTitle: 'All My Children',
      seriesEpisodeTitle: `${dateLabel} - Ep ${episode}`,
      seriesEligible: true,
      airDate,
      year: Number(airDate.slice(0, 4)),
      episodeNumber: episode,
      kind: full.length ? 'full' : 'part',
      kindBadge: full.length ? 'Episode' : 'Part',
      durationSeconds,
      subtitle,
      searchTerms,
      segments,
      alternates: alternateRows,
    },
  } as Program;
}

function makeExtraProgram(row: AllMyChildrenManifestRow, channel: AllMyChildrenManifestChannel): Program | null {
  if (!(row.bytes > 0) || !(row.durationSeconds >= 30)) return null;
  const parsed = parseAllMyChildrenFileName(row.file, row.durationSeconds);
  if (!EXPLICIT_EXTRA_KINDS.has(parsed.kind)) return null;
  const base = toProgram(archiveRow(row, channel.id, channel.name), channel.guideId);
  const title = row.title;
  return {
    ...base,
    title,
    description: 'All My Children',
    startTime: 0,
    endTime: 0,
    metadata: {
      ...base.metadata,
      thumbnailUrl: undefined,
      bytes: undefined,
      series: 'All My Children',
      seriesKey: SERIES_KEY,
      seriesTitle: 'All My Children',
      seriesEligible: undefined,
      airDate: parsed.date ?? undefined,
      ...(parsed.date ? { year: Number(parsed.date.slice(0, 4)) } : {}),
      episodeNumber: parsed.episode ?? undefined,
      kind: parsed.kind,
      kindBadge: parsed.kind[0].toUpperCase() + parsed.kind.slice(1),
      sourceFile: row.file,
      durationSeconds: row.durationSeconds,
      searchTerms: parsed.date ? [parsed.date] : [],
    },
  } as Program;
}

/** Build a date-only, non-rotating Archive channel from the static manifest. */
export function buildAllMyChildrenChannel(channel: AllMyChildrenManifestChannel): ScheduleChannel {
  const programs = channel.id === EPISODES_ID
    ? (() => {
      const groups = new Map<string, Candidate[]>();
      for (const row of channel.rows) {
        const candidate = parseEpisodeCandidate(row);
        if (!candidate) continue;
        const key = `${candidate.airDate}|${candidate.episode}`;
        const group = groups.get(key) ?? [];
        group.push(candidate);
        groups.set(key, group);
      }
      return [...groups.values()]
        .map((candidates) => makeEpisodeProgram(candidates, channel))
        .sort((a, b) =>
          String(a.metadata?.airDate).localeCompare(String(b.metadata?.airDate))
          || Number(a.metadata?.episodeNumber) - Number(b.metadata?.episodeNumber)
          || a.id.localeCompare(b.id));
    })()
    : channel.id === EXTRAS_ID
      ? channel.rows.map((row) => makeExtraProgram(row, channel)).filter((program): program is Program => program !== null)
        .sort((a, b) =>
          String(a.metadata?.airDate ?? '9999').localeCompare(String(b.metadata?.airDate ?? '9999'))
          || a.title.localeCompare(b.title)
          || a.id.localeCompare(b.id))
      : [];

  return {
    id: channel.id,
    guideId: channel.guideId,
    name: channel.name,
    mediaType: 'video',
    group: 'Soap Operas',
    programs,
    sourceStatus: 'snapshot',
  };
}

export function isAllMyChildrenChannel(channel: Pick<AllMyChildrenManifestChannel, 'id' | 'group'>): boolean {
  return channel.group === 'Soap Operas' && (channel.id === EPISODES_ID || channel.id === EXTRAS_ID);
}
