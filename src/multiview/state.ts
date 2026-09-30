import {
  MULTIVIEW_TILE_IDS,
  type MultiViewLayout,
  type MultiViewRuntimeState,
  type MultiViewTileId,
} from "./types";

export const DEFAULT_MULTIVIEW_LAYOUT: MultiViewLayout = "2x2";

export const DEFAULT_MULTIVIEW_STATE: MultiViewRuntimeState = {
  layout: DEFAULT_MULTIVIEW_LAYOUT,
  focusedTile: MULTIVIEW_TILE_IDS[0],
  audioTile: null,
};

export function isMultiViewTileId(value: string): value is MultiViewTileId {
  return (MULTIVIEW_TILE_IDS as readonly string[]).includes(value);
}

export function setFocusedTile(
  state: MultiViewRuntimeState,
  tileId: MultiViewTileId,
): MultiViewRuntimeState {
  return { ...state, focusedTile: tileId };
}

export function setLayout(
  state: MultiViewRuntimeState,
  layout: MultiViewLayout,
): MultiViewRuntimeState {
  return { ...state, layout };
}

/**
 * The runtime has one audio owner at most. Selecting a new tile replaces the
 * previous owner atomically; there is never an intermediate two-owner state.
 */
export function setAudioTile(
  state: MultiViewRuntimeState,
  tileId: MultiViewTileId | null,
): MultiViewRuntimeState {
  return { ...state, audioTile: tileId };
}

export function moveFocus(
  state: MultiViewRuntimeState,
  delta: number,
): MultiViewRuntimeState {
  const currentIndex = MULTIVIEW_TILE_IDS.indexOf(state.focusedTile);
  const nextIndex = Math.max(
    0,
    Math.min(MULTIVIEW_TILE_IDS.length - 1, currentIndex + delta),
  );
  return { ...state, focusedTile: MULTIVIEW_TILE_IDS[nextIndex] };
}
