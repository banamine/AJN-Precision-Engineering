import type { Channel, ChannelSource, MediaType, Program, ScheduleChannel } from '../types';

export interface ArchiveCatalogItem {
  itemId: string;
  title: string;
  creator?: string;
  mediaType: MediaType;
  yearPublished?: number;
  listId: string;
  listSlug: string;
}

export interface ArchiveCatalogSource {
  fileId: string;
  format: string;
  quality?: string;
  bitrateKbps?: number;
  url: string;
}

export interface ArchiveEpgEntry {
  item: ArchiveCatalogItem;
  source: ArchiveCatalogSource;
  channelId: string;
  programId: string;
  startTime: number;
  endTime: number;
}

export type ArchiveEpgProgram = Program & {
  metadata?: Record<string, unknown> & {
    archiveListId?: string;
    archiveListSlug?: string;
    archiveItemId?: string;
    archiveFileId?: string;
    sourceId?: string;
    assetId?: string;
  };
};

export interface ArchiveEpgChannel {
  channel: Channel;
  sources: ChannelSource[];
  programs: ArchiveEpgProgram[];
}

export interface ArchiveEpgSchedule extends ScheduleChannel {
  programs: ArchiveEpgProgram[];
}
