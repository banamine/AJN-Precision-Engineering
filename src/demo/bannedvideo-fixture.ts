import type { BannedVideoSnapshot } from '../bannedvideo/types';

const channels = [
  { name: 'DEMO — Channel A', network: 'ajn' as const, datedTitles: false },
  { name: 'DEMO — Channel B', network: 'ajn' as const, datedTitles: false },
  { name: 'DEMO — RAV channel', network: 'rav' as const, datedTitles: false },
];

const items = Array.from({ length: 8 }, (_, index) => {
  const id = `vdemo0${index + 1}`;
  return {
    id,
    rank: index + 1,
    title: `DEMO — synthetic video ${String(index + 1).padStart(2, '0')}`,
    channel: index < 3 ? channels[0].name : channels[1].name,
    durationSec: 95 + index * 7,
    thumbnailUrl: `https://banned.video/media/${id}.webp`,
    watchUrl: `https://banned.video/v/${id}`,
    maxHeight: null,
  };
});

/** In-memory only. These entries are invented and deliberately have no real image or player URLs. */
export const DEMO_BANNED_VIDEO_SNAPSHOT: BannedVideoSnapshot = {
  version: 1,
  source: 'DEMO — synthetic fixture',
  pages: [],
  scrapedAt: '2026-10-25T00:00:00.000Z',
  channels,
  items,
};
