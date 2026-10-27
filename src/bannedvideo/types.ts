/**
 * BANNED VIDEO wall: data types. Self-contained feature; nothing outside src/bannedvideo,
 * src/components/BannedVideoWall.tsx and src/data/bannedVideoSnapshot.json depends on these.
 */

/** AJN-vs-RAV separation tag. RAV content is never mixed into the AJN view (and vice versa). */
export type BannedVideoNetwork = "ajn" | "rav" | "other";

export interface BannedVideoChannel {
  /** Uploader channel name exactly as banned.video shows it. */
  name: string;
  network: BannedVideoNetwork;
  /** True when this channel's titles carry real air dates (used by the Vault panel). */
  datedTitles: boolean;
}

export interface BannedVideoItem {
  /** banned.video id: "v" + 6 lowercase letters/digits. */
  id: string;
  /** Position on the trending pages at scrape time (1 = top of page 1). */
  rank: number;
  title: string;
  channel: string;
  durationSec: number;
  thumbnailUrl: string;
  watchUrl: string;
  maxHeight: number | null;
}

export interface BannedVideoSnapshot {
  version: 1;
  source: string;
  pages: number[];
  /** ISO time the trending pages were read. Shown in the UI; rankings churn. */
  scrapedAt: string;
  channels: BannedVideoChannel[];
  items: BannedVideoItem[];
}

/** Air date parsed from a title. month/day are null when the title gives only a year or decade. */
export interface AirDate {
  year: number;
  month: number | null;
  day: number | null;
}

/** The view filter: network toggle plus optional uploader channel ("all" = every channel in the network). */
export type NetworkView = "ajn" | "rav";
export interface WallFilter {
  network: NetworkView;
  channel: string | "all";
}

export type PanelIndex = 0 | 1 | 2 | 3;
export const PANEL_INDICES: readonly PanelIndex[] = [0, 1, 2, 3];

/** P1 Trending, P2 Shuffle, P3 Vault (oldest), P4 Rotation (fair round robin). */
export type PanelMode = "trending" | "shuffle" | "vault" | "rotation";
export const PANEL_MODES: readonly PanelMode[] = ["trending", "shuffle", "vault", "rotation"];

export interface WallState {
  version: 1;
  /** Ids on screen per panel; null = no unique video left for that panel in this filter. */
  panels: [string | null, string | null, string | null, string | null];
  /** P1: index into rank order of the item currently shown (-1 before first pick). */
  trendingCursor: number;
  /** P2: ids not yet drawn in this round of the shuffle bag. */
  shuffleBag: string[];
  /** P3: oldest-first order (shuffled within year, then month) and the cursor into it. */
  vaultOrder: string[];
  vaultCursor: number;
  /** How many times each id has been put on screen (all panels). Drives P4 fairness. */
  queuedCounts: Record<string, number>;
}
