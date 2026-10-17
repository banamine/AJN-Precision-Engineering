import bundledShowInfo from '../data/showInfo.json';
import { validateShowInfoFile } from './validate';
import type { ShowInfo, ShowInfoFile } from './types';

export interface ShowInfoLookup {
  file: ShowInfoFile | null;
  count: number;
  getShowInfoByChannelId: (channelId: string) => ShowInfo | undefined;
  getShowInfoByArchiveIdentifier: (identifier: string) => ShowInfo | undefined;
}

function emptyLookup(): ShowInfoLookup {
  return {
    file: null,
    count: 0,
    getShowInfoByChannelId: () => undefined,
    getShowInfoByArchiveIdentifier: () => undefined,
  };
}

export function createShowInfoLookup(
  value: unknown,
  reportError?: (message: string) => void,
): ShowInfoLookup {
  let file: ShowInfoFile | null = null;
  try {
    file = validateShowInfoFile(value);
  } catch {
    file = null;
  }

  if (!file) {
    try {
      (reportError ?? console.error)('[AJN Show Info] Invalid showInfo.json; lookups are disabled.');
    } catch {
      // An unavailable console must not prevent the guide from loading.
    }
    return emptyLookup();
  }

  const byChannelId = new Map<string, ShowInfo>();
  const byArchiveIdentifier = new Map<string, ShowInfo>();
  for (const show of file.shows) {
    for (const channelId of show.links.channelIds) {
      if (!byChannelId.has(channelId)) byChannelId.set(channelId, show);
    }
    for (const identifier of show.links.archiveIdentifiers) {
      if (!byArchiveIdentifier.has(identifier)) byArchiveIdentifier.set(identifier, show);
    }
  }

  return {
    file,
    count: file.count,
    getShowInfoByChannelId: (channelId) => byChannelId.get(channelId),
    getShowInfoByArchiveIdentifier: (identifier) => byArchiveIdentifier.get(identifier),
  };
}

const bundledLookup = createShowInfoLookup(bundledShowInfo as unknown);

export const SHOW_INFO_FILE = bundledLookup.file;
export const SHOW_INFO_COUNT = bundledLookup.count;
export const getShowInfoByChannelId = bundledLookup.getShowInfoByChannelId;
export const getShowInfoByArchiveIdentifier = bundledLookup.getShowInfoByArchiveIdentifier;
