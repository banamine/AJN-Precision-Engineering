import {
  MULTIVIEW_TILE_IDS,
  type MultiViewAdmissionPolicy,
  type MultiViewTile,
  type MultiViewTileAdmission,
  type MultiViewTileId,
} from "./types";

export const DEFAULT_MULTIVIEW_ADMISSION_POLICY: MultiViewAdmissionPolicy = {
  maxConcurrentVideoElements: 2,
  maxIframes: 1,
};

function consumesVideoElement(tile: MultiViewTile): boolean {
  return tile.enabled && Boolean(tile.source) &&
    (tile.source?.type === "hls" || tile.source?.type === "mp4");
}

function consumesIframe(tile: MultiViewTile): boolean {
  return tile.enabled && tile.source?.type === "iframe";
}

function orderedTileIds(focusedTile: MultiViewTileId): MultiViewTileId[] {
  return [focusedTile, ...MULTIVIEW_TILE_IDS.filter((id) => id !== focusedTile)];
}

/**
 * Pure admission calculation. It never creates media elements or starts a
 * transport. Over-limit tiles are explicitly placed in poster_standby.
 */
export function evaluateMultiViewAdmission(
  tiles: readonly MultiViewTile[],
  focusedTile: MultiViewTileId,
  policy: MultiViewAdmissionPolicy = DEFAULT_MULTIVIEW_ADMISSION_POLICY,
): MultiViewTileAdmission[] {
  const byId = new Map(tiles.map((tile) => [tile.id, tile]));
  const admittedVideo = new Set<MultiViewTileId>();
  const admittedIframes = new Set<MultiViewTileId>();
  const result: MultiViewTileAdmission[] = [];

  for (const tileId of orderedTileIds(focusedTile)) {
    const tile = byId.get(tileId);

    if (!tile) {
      result.push({ tileId, status: "empty", reason: "empty" });
      continue;
    }

    if (!tile.enabled) {
      result.push({ tileId, status: "disabled", reason: "disabled" });
      continue;
    }

    if (!tile.source) {
      result.push({ tileId, status: "empty", reason: "empty" });
      continue;
    }

    if (consumesVideoElement(tile)) {
      if (admittedVideo.size >= policy.maxConcurrentVideoElements) {
        result.push({ tileId, status: "poster_standby", reason: "video_limit" });
      } else {
        admittedVideo.add(tileId);
        result.push({ tileId, status: "admitted" });
      }
      continue;
    }

    if (consumesIframe(tile)) {
      if (admittedIframes.size >= policy.maxIframes) {
        result.push({ tileId, status: "poster_standby", reason: "iframe_limit" });
      } else {
        admittedIframes.add(tileId);
        result.push({ tileId, status: "admitted" });
      }
      continue;
    }

    // Audio-only sources do not consume a video-element or iframe budget.
    result.push({ tileId, status: "admitted" });
  }

  return result.sort(
    (a, b) => MULTIVIEW_TILE_IDS.indexOf(a.tileId) - MULTIVIEW_TILE_IDS.indexOf(b.tileId),
  );
}

export function assertSingleAudioTile(
  audioTile: MultiViewTileId | null,
): MultiViewTileId | null {
  return audioTile;
}
