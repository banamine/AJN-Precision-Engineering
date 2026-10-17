export const YOUTUBE_GROUPS = [
  "tv-wire",
  "commentary",
  "business",
  "government-intl",
  "entertainment",
] as const;

export type YoutubeGroup = (typeof YOUTUBE_GROUPS)[number];

export const YOUTUBE_GROUP_LABELS: Record<YoutubeGroup, string> = {
  "tv-wire": "TV and wire news",
  commentary: "Commentary",
  business: "Business and finance",
  "government-intl": "Government and international",
  entertainment: "Entertainment",
};

export interface YoutubeChannel {
  id: string;
  name: string;
  handle: string;
  channelId: string;
  group: YoutubeGroup;
  region: "us" | "intl";
  pdfRank?: number;
  pdfSubscribers?: string;
  pageSubscribers?: string;
  main?: boolean;
  verifiedAt: string;
}

export interface YoutubeChannelRegistry {
  version: 2;
  generatedAt: string;
  note: string;
  channels: YoutubeChannel[];
  defaultSlots: string[];
}

export type YoutubeFailure =
  | "invalid-input"
  | "timeout"
  | "upstream-error"
  | "bad-response"
  | "rate-limited"
  | "disabled";

export interface YoutubeLatestVideo {
  videoId: string;
  title: string;
  publishedAt: string;
  views: number | null;
}

export interface YoutubeLatestSuccess {
  ok: true;
  channel: {
    id: string;
    name: string;
  };
  video: YoutubeLatestVideo;
  thumbnailUrl: string;
  asOf: string;
  stale: boolean;
  reason?: YoutubeFailure;
}

export type YoutubeLatestResponse =
  | YoutubeLatestSuccess
  | { ok: false; reason: YoutubeFailure };

export interface YoutubePanelSelection {
  videoId: string | null;
}

export interface YoutubePlaylist {
  id: string;
  title: string;
  thumbnailUrl: string;
  verifiedAt: string;
}

export interface YoutubePlaylistCatalogChannel {
  registryId: string;
  channelId: string;
  completeness: "partial" | "complete";
  live: {
    embedId: string;
    status: "unverified";
    suppliedBy: "user";
    suppliedAt: string;
  };
  playlists: YoutubePlaylist[];
}

export interface YoutubePlaylistCatalog {
  version: 1;
  generatedAt: string;
  note: string;
  channels: YoutubePlaylistCatalogChannel[];
}

export type YoutubePlaylistResolveResponse =
  | { ok: true; playlist: YoutubePlaylist }
  | { ok: false; reason: YoutubeFailure };
