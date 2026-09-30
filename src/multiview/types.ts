export const MULTIVIEW_TILE_IDS = ["tile-0", "tile-1", "tile-2", "tile-3"] as const;

export type MultiViewTileId = (typeof MULTIVIEW_TILE_IDS)[number];

export type MultiViewLayout = "2x2" | "2x1" | "1x1";

export type MultiViewSourceType = "hls" | "mp4" | "audio" | "iframe";

export interface MultiViewSource {
  type: MultiViewSourceType;
  url: string;
  title?: string;
}

export interface MultiViewTile {
  id: MultiViewTileId;
  source: MultiViewSource | null;
  enabled: boolean;
  title?: string;
}

export type MultiViewTileStatus =
  | "admitted"
  | "poster_standby"
  | "disabled"
  | "empty";

export interface MultiViewTileAdmission {
  tileId: MultiViewTileId;
  status: MultiViewTileStatus;
  reason?: "video_limit" | "iframe_limit" | "disabled" | "empty";
}

export interface MultiViewAdmissionPolicy {
  maxConcurrentVideoElements: number;
  maxIframes: number;
}

export interface MultiViewRuntimeState {
  layout: MultiViewLayout;
  focusedTile: MultiViewTileId;
  audioTile: MultiViewTileId | null;
}

export interface MultiViewModel {
  tiles: readonly MultiViewTile[];
  runtime: MultiViewRuntimeState;
  admission: readonly MultiViewTileAdmission[];
}
