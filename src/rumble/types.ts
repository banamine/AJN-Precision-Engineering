export type RumbleNetwork = "ajn" | "rav" | "other";

export interface RumbleChannel {
  id: string;
  network: RumbleNetwork;
  name: string;
  url: string;
}

export type RumbleItemKind = "live" | "continuous_live" | "vod" | "short";
export type RumbleItemState = "live" | "ended" | "vod";

export interface RumbleItem {
  channelId: string;
  videoId: string;
  embedId: string;
  title: string;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  startedAt?: string | null;
  durationSec: number | null;
  kind: RumbleItemKind;
  liveStreamId?: string;
  state: RumbleItemState;
  viewers?: number | null;
}

export interface RumbleBaseline {
  version: number;
  generatedAt: string;
  channels: RumbleChannel[];
  items: RumbleItem[];
}
