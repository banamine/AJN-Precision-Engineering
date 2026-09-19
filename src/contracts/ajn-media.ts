import type { MediaType, Program } from "../types";

/**
 * Presentation/provenance contract layered on top of the existing AJN Program model.
 * This is additive: existing Program, NowPlayingMedia, playlists, schedules, and
 * MinimalPlayer remain the runtime path.
 */
export type AjnSourceFamily =
  | "archive"
  | "live"
  | "rss"
  | "playlist"
  | "unknown";

export type AjnSourceKind =
  | "archive-video"
  | "archive-audio"
  | "live-video"
  | "live-audio"
  | "rss-story"
  | "playlist-item"
  | "unknown";

export type AjnSourceAuthority =
  | "archive.org"
  | "ajn"
  | "external"
  | "unknown";

export interface AjnVisualAsset {
  key: string;
  title: string;
  imageUrl: string;
  category: string;
}

export interface AjnMediaRecord {
  id: string;
  programId: string;
  title: string;
  mediaType: MediaType;
  playable: boolean;
  playbackUrl: string | null;
  archivePath?: string;
  sourceFamily: AjnSourceFamily;
  sourceKind: AjnSourceKind;
  sourceAuthority: AjnSourceAuthority;
  visualAssetKey?: string;
  category?: string;
  description?: string;
  startTime?: number;
  endTime?: number;
  channelId?: string;
  guideId?: string;
  isLive?: boolean;
  originalProgramId?: string;
}

export interface AjnCategoryDestination {
  key: string;
  title: string;
  visualAssetKey: string;
  category: string;
  destination: "browse" | "search" | "library";
}

export interface AjnPresentationAdapter {
  fromProgram(program: Program): AjnMediaRecord;
}
