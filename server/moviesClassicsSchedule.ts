import type { Program } from '../src/types';

export const MOVIES_CLASSICS_LEGACY_CHANNEL_ID = 'mx-movies-classics-list';
export const MOVIES_CLASSICS_PARTITION_PREFIX = 'mx-movies-classics-';
export const MOVIES_CLASSICS_PARTITION_COUNT = 20;

export interface MoviesClassicsManifestRow {
  id: string;
  identifier: string;
  file: string;
  title: string;
  bytes: number;
  durationSeconds: number;
  thumb: string | null;
}

export interface MoviesClassicsManifestChannel {
  guideId: string;
  id: string;
  name: string;
  group: string;
  rows: MoviesClassicsManifestRow[];
  deferLightRows?: boolean;
  legacyChannelId?: string;
}

const DECADE_BUCKETS = [
  'Pre-1940',
  '1940s',
  '1950s',
  '1960s',
  '1970s',
  '1980s',
  '1990s',
  '2000s',
  '2010s+',
  'Unknown year',
] as const;
const MIN_CHANNEL_ROWS = 60;
const MAX_CHANNEL_ROWS = 250;

function titleCompare(a: string, b: string): number {
  const left = a.normalize('NFKC').trim().toLowerCase();
  const right = b.normalize('NFKC').trim().toLowerCase();
  return left < right ? -1 : left > right ? 1 : 0;
}

function bucketForTitle(title: string): string {
  const match = title.match(/\((19\d{2}|20\d{2})\)/);
  if (!match) return 'Unknown year';
  const year = Number(match[1]);
  if (year < 1940) return 'Pre-1940';
  if (year >= 2010) return '2010s+';
  return `${Math.floor(year / 10) * 10}s`;
}

function alphaInitial(title: string): string {
  const normalized = title.normalize('NFKD').toUpperCase();
  return normalized.match(/[A-Z0-9]/)?.[0] ?? '#';
}

function chunkRange(rows: MoviesClassicsManifestRow[]): string {
  const first = alphaInitial(rows[0]?.title ?? '');
  const last = alphaInitial(rows.at(-1)?.title ?? '');
  return first === last ? first : `${first}–${last}`;
}

/** Split only the legacy movie list. Input rows are copied, never discarded or mutated. */
export function splitMoviesClassicsChannel<T extends MoviesClassicsManifestChannel>(channel: T): T[] {
  if (channel.id !== MOVIES_CLASSICS_LEGACY_CHANNEL_ID) return [channel];

  const buckets = new Map<string, MoviesClassicsManifestRow[]>(
    DECADE_BUCKETS.map((bucket) => [bucket, []]),
  );
  for (const row of channel.rows) buckets.get(bucketForTitle(row.title))!.push(row);

  // Small decades are merged into the nearest nonempty bucket; unknown years sit beside 2010s+.
  const bucketIndex = (bucket: string) => DECADE_BUCKETS.indexOf(bucket as typeof DECADE_BUCKETS[number]);
  for (const bucket of DECADE_BUCKETS) {
    const rows = buckets.get(bucket)!;
    if (!rows.length || rows.length >= MIN_CHANNEL_ROWS) continue;
    const sourceIndex = bucketIndex(bucket);
    const target = DECADE_BUCKETS
      .filter((candidate) => candidate !== bucket && buckets.get(candidate)!.length > 0)
      .sort((a, b) => {
        const distance = Math.abs(bucketIndex(a) - sourceIndex) - Math.abs(bucketIndex(b) - sourceIndex);
        return distance || bucketIndex(a) - bucketIndex(b);
      })[0];
    if (!target) throw new Error(`Movie bucket ${bucket} has fewer than ${MIN_CHANNEL_ROWS} rows and no merge target`);
    buckets.get(target)!.push(...rows);
    buckets.set(bucket, []);
  }

  const output: T[] = [];
  for (const bucket of DECADE_BUCKETS) {
    const rows = buckets.get(bucket)!;
    if (!rows.length) continue;
    rows.sort((a, b) => titleCompare(a.title, b.title)
      || titleCompare(a.identifier, b.identifier)
      || titleCompare(a.file, b.file)
      || titleCompare(a.id, b.id));
    const partCount = Math.ceil(rows.length / MAX_CHANNEL_ROWS);
    const baseSize = Math.floor(rows.length / partCount);
    const extra = rows.length % partCount;
    let offset = 0;
    for (let part = 0; part < partCount; part++) {
      const size = baseSize + (part >= partCount - extra ? 1 : 0);
      const partRows = rows.slice(offset, offset + size);
      offset += size;
      if (partRows.length < MIN_CHANNEL_ROWS || partRows.length > MAX_CHANNEL_ROWS) {
        throw new Error(`Movie partition ${bucket} ${part + 1}/${partCount} has ${partRows.length} rows`);
      }
      const suffix = partCount > 1 ? ` · Part ${part + 1} of ${partCount}` : '';
      const ordinal = String(output.length + 1).padStart(2, '0');
      output.push({
        ...channel,
        id: `${MOVIES_CLASSICS_PARTITION_PREFIX}${ordinal}`,
        name: `Movies Classics · ${bucket}${suffix}`,
        legacyChannelId: MOVIES_CLASSICS_LEGACY_CHANNEL_ID,
        rows: partRows,
      } as T);
    }
  }

  if (offsetForRows(output) !== channel.rows.length) {
    throw new Error('Movie channel split did not preserve every source row');
  }
  if (new Set(output.flatMap((partition) => partition.rows.map((row) => row.id))).size !== channel.rows.length) {
    throw new Error('Movie channel split duplicated or lost a source row');
  }
  return output;
}

function offsetForRows(channels: MoviesClassicsManifestChannel[]): number {
  return channels.reduce((count, channel) => count + channel.rows.length, 0);
}

const sourcePath = (program: Program): string => String(program.archivePath || program.mediaUrl || '').split('?')[0];
const titleKey = (program: Program): string => String(program.title ?? '')
  .normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const identifierKey = (program: Program): string => String(
  program.metadata?.archiveIdentifier ?? program.metadata?.identifier ?? program.sourceId ?? 'unknown',
);

/** Stable identifier round-robin with the owner's title window and no duplicate file entries. */
export function buildBalancedMovieOrder(programs: Program[]): Program[] {
  const byPath = new Map<string, Program>();
  for (const program of programs) {
    const key = sourcePath(program) || `program:${program.id}`;
    if (!byPath.has(key)) byPath.set(key, program);
  }
  const unique = [...byPath.values()];
  if (unique.length <= 1) return unique;

  const distinctTitles = new Set(unique.map(titleKey)).size;
  const titleWindow = distinctTitles >= 11 ? 10 : Math.max(0, distinctTitles - 1);
  const queues = new Map<string, Program[]>();
  for (const program of unique) {
    const identifier = identifierKey(program);
    const queue = queues.get(identifier) ?? [];
    queue.push(program);
    queues.set(identifier, queue);
  }
  const identifiers = [...queues.keys()].sort();
  for (const queue of queues.values()) {
    queue.sort((a, b) => titleCompare(a.title, b.title)
      || titleCompare(sourcePath(a), sourcePath(b))
      || titleCompare(a.id, b.id));
  }

  const remaining = new Map(identifiers.map((identifier) => [identifier, [...queues.get(identifier)!]]));
  const output: Program[] = [];
  const recentTitles: string[] = [];
  const lastAiredByTitle = new Map<string, number>();
  let nextIdentifier = 0;

  while ([...remaining.values()].some((queue) => queue.length > 0)) {
    let selected: { identifier: string; queueIndex: number; program: Program; relaxed: boolean } | undefined;
    for (let step = 0; step < identifiers.length && !selected; step++) {
      const identifierIndex = (nextIdentifier + step) % identifiers.length;
      const identifier = identifiers[identifierIndex];
      const queue = remaining.get(identifier)!;
      const queueIndex = queue.findIndex((program) =>
        (!output.length || sourcePath(program) !== sourcePath(output.at(-1)!))
        && (titleWindow === 0 || !recentTitles.includes(titleKey(program))),
      );
      if (queueIndex >= 0) selected = { identifier, queueIndex, program: queue[queueIndex], relaxed: false };
    }

    if (!selected) {
      const fallback = identifiers.flatMap((identifier, identifierIndex) =>
        remaining.get(identifier)!.map((program, queueIndex) => ({
          identifier,
          queueIndex,
          program,
          identifierDistance: (identifierIndex - nextIdentifier + identifiers.length) % identifiers.length,
          lastAired: lastAiredByTitle.get(titleKey(program)) ?? Number.NEGATIVE_INFINITY,
        })),
      ).filter((candidate) => !output.length || sourcePath(candidate.program) !== sourcePath(output.at(-1)!))
        .sort((a, b) => a.lastAired - b.lastAired
          || a.identifierDistance - b.identifierDistance
          || titleCompare(a.program.title, b.program.title)
          || titleCompare(sourcePath(a.program), sourcePath(b.program)))[0];
      if (!fallback) throw new Error('Movie rotation cannot select a distinct next file');
      selected = { ...fallback, relaxed: true };
    }

    const queue = remaining.get(selected.identifier)!;
    queue.splice(selected.queueIndex, 1);
    const key = titleKey(selected.program);
    const program = selected.relaxed
      ? { ...selected.program, metadata: { ...(selected.program.metadata ?? {}), rotationWindowRelaxed: true } }
      : selected.program;
    output.push(program);
    lastAiredByTitle.set(key, output.length - 1);
    if (titleWindow > 0) {
      recentTitles.push(key);
      if (recentTitles.length > titleWindow) recentTitles.shift();
    }
    nextIdentifier = (identifiers.indexOf(selected.identifier) + 1) % identifiers.length;
  }

  // The sequence is cyclic across daily boundaries. Mark any unavoidable title-window
  // collision at the wrap so reports count the actual relaxed slots.
  if (titleWindow > 0) {
    for (let index = 0; index < output.length; index++) {
      const key = titleKey(output[index]);
      const span = Math.min(titleWindow, output.length - 1);
      for (let distance = 1; distance <= span; distance++) {
        if (titleKey(output[(index - distance + output.length) % output.length]) === key) {
          if (!output[index].metadata?.rotationWindowRelaxed) {
            output[index] = {
              ...output[index],
              metadata: { ...(output[index].metadata ?? {}), rotationWindowRelaxed: true },
            };
          }
          break;
        }
      }
    }
  }
  return output;
}

export function layoutBalancedMovieSchedule(
  programs: Program[],
  defaultMinutes: number,
  now: Date,
): Program[] {
  if (!Number.isFinite(now.getTime()) || now.getTime() < Date.UTC(2026, 0, 1)) {
    throw new RangeError('Movie schedule date must be valid and at or after 2026-01-01');
  }
  if (!Number.isFinite(defaultMinutes) || defaultMinutes <= 0) {
    throw new RangeError('Movie rotation default duration must be positive and finite');
  }

  const uniqueByPath = new Map<string, Program>();
  for (const program of programs) {
    const path = sourcePath(program) || `program:${program.id}`;
    if (!uniqueByPath.has(path)) uniqueByPath.set(path, program);
  }
  const unique = [...uniqueByPath.values()];
  if (!unique.length) return [];

  const queues = new Map<string, Program[]>();
  for (const program of unique) {
    const identifier = identifierKey(program);
    const queue = queues.get(identifier) ?? [];
    queue.push(program);
    queues.set(identifier, queue);
  }
  const identifiers = [...queues.keys()].sort();
  const positionByProgram = new Map<Program, { identifier: string; identifierIndex: number; queueIndex: number }>();
  for (const queue of queues.values()) {
    queue.sort((a, b) => titleCompare(a.title, b.title)
      || titleCompare(sourcePath(a), sourcePath(b))
      || titleCompare(a.id, b.id));
  }
  for (const [identifierIndex, identifier] of identifiers.entries()) {
    queues.get(identifier)!.forEach((program, queueIndex) => {
      positionByProgram.set(program, { identifier, identifierIndex, queueIndex });
    });
  }

  const cursors = new Map(identifiers.map((identifier) => [identifier, 0]));
  const distinctTitles = new Set(unique.map(titleKey)).size;
  const titleWindow = distinctTitles >= 11 ? 10 : Math.max(0, distinctTitles - 1);
  const recentTitles: string[] = [];
  const lastAiredByPath = new Map<string, number>();
  const lastAiredByTitle = new Map<string, number>();
  const epoch = Date.UTC(2026, 0, 1);
  const targetMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const targetDay = Math.floor((targetMidnight - epoch) / 86_400_000);
  let nextIdentifier = 0;
  let lastPath = '';
  let airingIndex = 0;
  let targetSchedule: Program[] = [];

  // Replay from a fixed UTC origin so midnight state is deterministic without
  // persisting mutable scheduler state or relying on request order.
  for (let dayIndex = 0; dayIndex <= targetDay; dayIndex++) {
    const midnight = epoch + dayIndex * 86_400_000;
    const dayEnd = midnight + 86_400_000;
    let time = midnight;
    const daySchedule: Program[] = [];

    while (time < dayEnd) {
      let selected: { identifier: string; identifierIndex: number; queueIndex: number; program: Program; relaxed: boolean } | undefined;
      for (let step = 0; step < identifiers.length && !selected; step++) {
        const identifierIndex = (nextIdentifier + step) % identifiers.length;
        const identifier = identifiers[identifierIndex];
        const queue = queues.get(identifier)!;
        const cursor = cursors.get(identifier)!;
        for (let offset = 0; offset < queue.length; offset++) {
          const queueIndex = (cursor + offset) % queue.length;
          const program = queue[queueIndex];
          const path = sourcePath(program) || `program:${program.id}`;
          const title = titleKey(program);
          if (path === lastPath || (titleWindow > 0 && recentTitles.includes(title))) continue;
          selected = { identifier, identifierIndex, queueIndex, program, relaxed: false };
          break;
        }
      }

      if (!selected) {
        const fallback = unique
          .filter((program) => (sourcePath(program) || `program:${program.id}`) !== lastPath)
          .map((program) => {
            const position = positionByProgram.get(program)!;
            return {
              ...position,
              program,
              lastAired: lastAiredByPath.get(sourcePath(program) || `program:${program.id}`) ?? Number.NEGATIVE_INFINITY,
              titleLastAired: lastAiredByTitle.get(titleKey(program)) ?? Number.NEGATIVE_INFINITY,
              identifierDistance: (position.identifierIndex - nextIdentifier + identifiers.length) % identifiers.length,
            };
          })
          .sort((a, b) => a.lastAired - b.lastAired
            || a.titleLastAired - b.titleLastAired
            || a.identifierDistance - b.identifierDistance
            || titleCompare(a.program.title, b.program.title)
            || titleCompare(sourcePath(a.program), sourcePath(b.program)))[0];
        if (!fallback) {
          if (unique.length === 1) break;
          throw new Error('Movie rotation cannot select a distinct next file');
        }
        selected = { ...fallback, relaxed: titleWindow > 0 };
      }

      const queue = queues.get(selected.identifier)!;
      cursors.set(selected.identifier, (selected.queueIndex + 1) % queue.length);
      nextIdentifier = (selected.identifierIndex + 1) % identifiers.length;
      const programPath = sourcePath(selected.program) || `program:${selected.program.id}`;
      const programTitle = titleKey(selected.program);
      const durationSeconds = Number(selected.program.metadata?.durationSeconds) > 0
        ? Number(selected.program.metadata?.durationSeconds)
        : defaultMinutes * 60;
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        throw new RangeError(`Movie duration must be positive and finite: ${selected.program.id}`);
      }
      const stop = Math.min(time + durationSeconds * 1000, dayEnd);
      const hour = (value: number) => (value - midnight) / 3_600_000;
      const scheduled: Program = {
        ...selected.program,
        id: `${selected.program.id}:d${daySchedule.length}`,
        metadata: {
          ...(selected.program.metadata ?? {}),
          airedUtc: selected.program.metadata?.airedUtc ?? selected.program.startTimeUtc,
          ...(selected.relaxed ? { rotationWindowRelaxed: true } : {}),
        },
        startTimeUtc: new Date(time).toISOString(),
        endTimeUtc: new Date(stop).toISOString(),
        startTime: hour(time),
        endTime: hour(stop),
        startHour: hour(time),
        endHour: hour(stop),
      };

      daySchedule.push(scheduled);
      lastPath = programPath;
      lastAiredByPath.set(programPath, airingIndex);
      lastAiredByTitle.set(programTitle, airingIndex);
      airingIndex++;
      if (titleWindow > 0) {
        recentTitles.push(programTitle);
        if (recentTitles.length > titleWindow) recentTitles.shift();
      }
      time = stop;
    }

    if (dayIndex === targetDay) targetSchedule = daySchedule;
  }

  return targetSchedule;
}

export function summarizeMovieSchedule(programs: Program[], sourceIdentifierCount?: number) {
  const identifierCounts = new Map<string, number>();
  const fileSet = new Set<string>();
  const titleCounts = new Map<string, number>();
  let longestIdenticalTitleRun = 0;
  let currentTitle = '';
  let currentRun = 0;
  let windowRelaxed = 0;
  for (const program of programs) {
    const identifier = identifierKey(program);
    identifierCounts.set(identifier, (identifierCounts.get(identifier) ?? 0) + 1);
    fileSet.add(sourcePath(program) || `program:${program.id}`);
    const title = titleKey(program);
    titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
    if (title === currentTitle) currentRun++;
    else { currentTitle = title; currentRun = 1; }
    longestIdenticalTitleRun = Math.max(longestIdenticalTitleRun, currentRun);
    if (program.metadata?.rotationWindowRelaxed === true) windowRelaxed++;
  }
  const identifiers = sourceIdentifierCount ?? identifierCounts.size;
  const maxIdentifierSlots = Math.max(0, ...identifierCounts.values());
  const maxIdentifierShare = programs.length ? maxIdentifierSlots / programs.length : 0;
  return {
    scheduledSlots: programs.length,
    films: fileSet.size,
    identifiers,
    distinctTitles: titleCounts.size,
    maxIdentifierSlots,
    maxIdentifierShare,
    identifierShareSoftCap: identifiers ? Math.max(0.05, 2 / identifiers) : 0,
    identifierShareOverSoftCap: maxIdentifierShare > (identifiers ? Math.max(0.05, 2 / identifiers) : 0),
    longestIdenticalTitleRun,
    windowRelaxed,
  };
}

/** Existing channel URLs/favorites that still hold the former monolithic ID resolve to its first partition. */
export function resolveMoviesClassicChannelAlias(channelId: string): string {
  return channelId === MOVIES_CLASSICS_LEGACY_CHANNEL_ID
    ? `${MOVIES_CLASSICS_PARTITION_PREFIX}01`
    : channelId;
}
