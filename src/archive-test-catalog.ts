import type { Channel, ChannelSource, Program } from './types';
import type { ArchiveEpgProgram } from './contracts/archive-epg';

export const CLASSIC_TV_TEST_CHANNEL: Channel = {
  id: 'classic-tv-101',
  guideId: 'cable-tv',
  name: 'AJN Classic TV',
  mediaType: 'video',
  group: 'TV Classics',
  tvgId: 'classic-tv-101',
  tvgName: 'AJN Classic TV',
  enabled: true,
};

const makeProgram = (
  index: number,
  title: string,
  itemId: string,
  fileId: string,
  mediaUrl: string,
  startTime: number,
  endTime: number,
  thumbnailUrl?: string,
): ArchiveEpgProgram => ({
  id: `classic-tv-101-${index}`,
  guideId: 'cable-tv',
  channelId: CLASSIC_TV_TEST_CHANNEL.id,
  title,
  description: title,
  startTime,
  endTime,
  mediaType: 'video',
  mediaUrl,
  archivePath: mediaUrl,
  metadata: {
    archiveListId: '4',
    archiveListSlug: 'tv-classics',
    archiveItemId: itemId,
    archiveFileId: fileId,
    sourceId: `src-classic-tv-101-${index}`,
    assetId: `asset-classic-tv-101-${index}`,
    channelNumber: '101',
    thumbnailUrl,
  },
});

export const CLASSIC_TV_TEST_PROGRAMS: ArchiveEpgProgram[] = [
  makeProgram(
    1,
    'The Incredible Hulk VHS volumes 1 & 2',
    'the_incredible_hulk_vhs',
    'hulk_vol1_2.mp4',
    'https://archive.org/download/the_incredible_hulk_vhs/hulk_vol1_2.mp4',
    0,
    3600,
  ),
  makeProgram(
    2,
    'Thriller (1973 - 1976) - Episode 1',
    'thriller_1973_1976',
    'thriller_s01e01.mp4',
    'https://archive.org/download/thriller_1973_1976/thriller_s01e01.mp4',
    3600,
    7200,
  ),
  makeProgram(
    3,
    'Space: 1999 - S01E01 Breakaway',
    'space_1999_s01e01',
    'space_1999_s01e01.mp4',
    'https://archive.org/download/space_1999_s01e01/space_1999_s01e01.mp4',
    7200,
    10800,
  ),
];

export const CLASSIC_TV_TEST_SOURCES: ChannelSource[] = CLASSIC_TV_TEST_PROGRAMS.map((program, index) => ({
  id: `src-classic-tv-101-${index + 1}`,
  channelId: CLASSIC_TV_TEST_CHANNEL.id,
  protocol: 'direct_archive',
  url: program.mediaUrl,
  title: program.title,
  type: 'video',
  priority: index + 1,
  enabled: true,
  metadata: program.metadata,
}));

export const CLASSIC_TV_TEST_SCHEDULE = {
  channel: CLASSIC_TV_TEST_CHANNEL,
  sources: CLASSIC_TV_TEST_SOURCES,
  programs: CLASSIC_TV_TEST_PROGRAMS as Program[],
};
