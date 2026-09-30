import type { RumbleBaseline } from "./types";

/**
 * Manually refreshed, checked-in seed data.
 * The server never requests rumble.com. Thumbnail URLs remain null until a
 * manually verified thumbnail URL is imported.
 */
export const RUMBLE_BASELINE: RumbleBaseline = {
  version: 1,
  generatedAt: "2026-09-30T00:00:00.000Z",
  channels: [
    {
      id: "ajn-alex-jones-show",
      network: "ajn",
      name: "Alex Jones Show",
      url: "https://rumble.com/c/TheAlexJonesShowLive",
    },
    {
      id: "ajn-war-room",
      network: "ajn",
      name: "War Room with Harrison Smith",
      url: "https://rumble.com/c/WarRoomRumble",
    },
    {
      id: "rav-real-americas-voice",
      network: "rav",
      name: "Real America's Voice",
      url: "https://rumble.com/user/RealAmericasVoice",
    },
  ],
  items: [
    {
      channelId: "ajn-alex-jones-show",
      videoId: "ajn-full-alex-jones-show-2026-09-29",
      embedId: "ajn-full-alex-jones-show-2026-09-29",
      title: "FULL ALEX JONES SHOW — 9/29/26",
      thumbnailUrl: null,
      publishedAt: null,
      durationSec: null,
      kind: "vod",
      state: "vod",
    },
    {
      channelId: "ajn-alex-jones-show",
      videoId: "ajn-full-sunday-night-live-2026-09-27",
      embedId: "ajn-full-sunday-night-live-2026-09-27",
      title: "FULL SUNDAY NIGHT LIVE — 9/27/26",
      thumbnailUrl: null,
      publishedAt: null,
      durationSec: null,
      kind: "vod",
      state: "vod",
    },
    {
      channelId: "ajn-alex-jones-show",
      videoId: "ajn-alex-jones-show-2026-09-26",
      embedId: "ajn-alex-jones-show-2026-09-26",
      title: "The Alex Jones Show 9/26/2026",
      thumbnailUrl: null,
      publishedAt: null,
      durationSec: null,
      kind: "vod",
      state: "vod",
    },
    {
      channelId: "ajn-war-room",
      network: undefined as never,
      videoId: "ajn-war-room-live-2026-09-29",
      embedId: "ajn-war-room-live-2026-09-29",
      title: "WAR ROOM LIVE TUESDAY FULL SHOW 9/29/26",
      thumbnailUrl: null,
      publishedAt: null,
      durationSec: null,
      kind: "vod",
      state: "vod",
    },
    {
      channelId: "rav-real-americas-voice",
      videoId: "rav-war-room-live-2026-09-29",
      embedId: "rav-war-room-live-2026-09-29",
      title: "Steve Bannon's War Room — 9/29/26",
      thumbnailUrl: null,
      publishedAt: null,
      durationSec: null,
      kind: "vod",
      state: "vod",
    },
  ],
};
