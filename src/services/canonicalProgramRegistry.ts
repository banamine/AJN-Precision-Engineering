import type { Program } from '../types';
import { normalizeProgramIdentity } from '../utils/epgIdentity';

const programsMap = new Map<string, Program>();
const PROGRAM_RETENTION_MS = 24 * 60 * 60 * 1000;

function toUtcMs(value?: string | Date): number {
  if (!value) return Number.NaN;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function evictExpiredPrograms(nowMs = Date.now()): number {
  const cutoff = nowMs - PROGRAM_RETENTION_MS;
  let removed = 0;
  for (const [id, program] of programsMap) {
    const endMs = toUtcMs(program.endTimeUtc);
    if (Number.isFinite(endMs) && endMs < cutoff) {
      programsMap.delete(id);
      removed += 1;
    }
  }
  return removed;
}

export function upsertCanonicalProgram(program: Program): Program {
  const identity = normalizeProgramIdentity({
    externalId: program.metadata?.externalId,
    channelId: program.channelId,
    title: program.title,
    startTime: program.startTimeUtc ?? program.startTime,
  });
  const canonical = identity === program.id ? program : { ...program, id: identity };
  if (canonical.id !== program.id) programsMap.delete(program.id);
  programsMap.set(canonical.id, canonical);
  evictExpiredPrograms();
  return canonical;
}

export function getCanonicalProgram(id: string): Program | undefined {
  evictExpiredPrograms();
  return programsMap.get(id);
}

export function getCanonicalPrograms(): Program[] {
  evictExpiredPrograms();
  return Array.from(programsMap.values());
}

export function sweepCanonicalPrograms(nowMs = Date.now()): number {
  return evictExpiredPrograms(nowMs);
}
