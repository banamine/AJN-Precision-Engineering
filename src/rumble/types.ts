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
  /** Optional full video page URL from the export. If absent, one is built from videoId (any slug resolves). */
  pageUrl?: string | null;
  title: string;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  startedAt?: string | null;
  /** When this item was last read from Rumble (export time). Falls back to baseline.generatedAt. */
  seenAt?: string | null;
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
