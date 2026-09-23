import assert from 'node:assert/strict';
import type { ArchiveEpgChannel, ArchiveEpgProgram } from './archive-epg';

const p1: ArchiveEpgProgram = {
  id: 'classic-tv-1',
  guideId: 'cable-tv',
  channelId: 'classic-tv',
  title: 'Episode 1',
  startTime: 0,
  endTime: 1800,
  mediaType: 'video',
  mediaUrl: '/download/example/episode1.mp4',
  archivePath: '/download/example/episode1.mp4',
  metadata: { archiveListId: '4', archiveListSlug: 'tv-classics', archiveItemId: 'item-1', archiveFileId: 'file-1', sourceId: 'src-1', assetId: 'asset-1' },
};

const p2: ArchiveEpgProgram = {
  ...p1,
  id: 'classic-tv-2',
  title: 'Episode 2',
  startTime: 1800,
  endTime: 3600,
  mediaUrl: '/download/example/episode2.mp4',
  archivePath: '/download/example/episode2.mp4',
  metadata: { ...p1.metadata, archiveItemId: 'item-2', archiveFileId: 'file-2', sourceId: 'src-2', assetId: 'asset-2' },
};

const channel: ArchiveEpgChannel = {
  channel: {
    id: 'classic-tv',
    guideId: 'cable-tv',
    name: 'AJN Classic TV',
    mediaType: 'video',
    enabled: true,
  },
  sources: [{ id: 'src-1', channelId: 'classic-tv', protocol: 'https', url: p1.mediaUrl, priority: 1, enabled: true }],
  programs: [p1, p2],
};

assert.equal(channel.programs.length, 2);
assert.equal(channel.programs[0].channelId, channel.channel.id);
assert.equal(channel.programs[1].mediaType, 'video');
assert.equal(channel.programs[1].metadata?.archiveListSlug, 'tv-classics');
assert.ok(channel.sources[0].url.includes('/download/'));
