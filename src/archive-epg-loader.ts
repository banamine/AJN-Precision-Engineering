import type { ArchiveEpgProgram } from './contracts/archive-epg';
import { CLASSIC_TV_TEST_CHANNEL, CLASSIC_TV_TEST_PROGRAMS } from './archive-test-catalog';

export const ARCHIVE_EPG_MAX_CHANNELS = 5000;
export const ARCHIVE_EPG_DEFAULT_LIMIT = 50;
export const ARCHIVE_EPG_MAX_LIMIT = 100;

export interface EpgPage<T> {
  items: T[];
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

function boundedInteger(value: unknown, fallback: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

export function getArchiveChannelPage<T>(channels: T[], offsetInput?: unknown, limitInput?: unknown): EpgPage<T> {
  const limit = boundedInteger(limitInput, ARCHIVE_EPG_DEFAULT_LIMIT, ARCHIVE_EPG_MAX_LIMIT);
  const offset = boundedInteger(offsetInput, 0, ARCHIVE_EPG_MAX_CHANNELS);
  const bounded = channels.slice(0, ARCHIVE_EPG_MAX_CHANNELS);
  const items = bounded.slice(offset, offset + limit);
  return { items, offset, limit, total: bounded.length, hasMore: offset + items.length < bounded.length };
}

export function getArchiveProgramPage(
  channelId: string,
  offsetInput?: unknown,
  limitInput?: unknown,
): EpgPage<ArchiveEpgProgram> {
  const limit = boundedInteger(limitInput, ARCHIVE_EPG_DEFAULT_LIMIT, ARCHIVE_EPG_MAX_LIMIT);
  const offset = boundedInteger(offsetInput, 0, Number.MAX_SAFE_INTEGER);
  const programs = channelId === CLASSIC_TV_TEST_CHANNEL.id ? CLASSIC_TV_TEST_PROGRAMS : [];
  const items = programs.slice(offset, offset + limit);
  return { items, offset, limit, total: programs.length, hasMore: offset + items.length < programs.length };
}

export function getArchiveChannelSummary() {
  return {
    id: CLASSIC_TV_TEST_CHANNEL.id,
    guideId: CLASSIC_TV_TEST_CHANNEL.guideId,
    name: CLASSIC_TV_TEST_CHANNEL.name,
    mediaType: CLASSIC_TV_TEST_CHANNEL.mediaType,
    group: CLASSIC_TV_TEST_CHANNEL.group,
    tvgId: CLASSIC_TV_TEST_CHANNEL.tvgId,
    tvgName: CLASSIC_TV_TEST_CHANNEL.tvgName,
    enabled: CLASSIC_TV_TEST_CHANNEL.enabled,
    programCount: CLASSIC_TV_TEST_PROGRAMS.length,
  };
}
