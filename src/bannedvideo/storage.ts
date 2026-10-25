import { BANNED_VIDEO_ID } from "./validate";
import type { WallFilter, WallState } from "./types";

/** Per-viewer convenience only (filter + panel positions + queued counts). Safe to lose. */
export const BANNED_VIDEO_STORAGE_KEY = "ajn.wall.bannedvideo.v1";

export interface SavedWall { version: 1; filter: WallFilter; state: WallState }

export interface WallStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function browserWallStorage(): WallStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const isId = (value: unknown): value is string => typeof value === "string" && BANNED_VIDEO_ID.test(value);
const isIdOrNull = (value: unknown): value is string | null => value === null || isId(value);
const isIndex = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= -1;

function parseSaved(raw: string | null): SavedWall | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const v = value as Record<string, unknown>;
    const filter = v.filter as Record<string, unknown> | undefined;
    const state = v.state as Record<string, unknown> | undefined;
    if (v.version !== 1 || !filter || !state) return null;
    if ((filter.network !== "ajn" && filter.network !== "rav") || typeof filter.channel !== "string") return null;
    const panels = state.panels;
    const counts = state.queuedCounts;
    if (
      state.version !== 1
      || !Array.isArray(panels) || panels.length !== 4 || !panels.every(isIdOrNull)
      || !isIndex(state.trendingCursor) || !isIndex(state.vaultCursor)
      || !Array.isArray(state.shuffleBag) || !state.shuffleBag.every(isId)
      || !Array.isArray(state.vaultOrder) || !state.vaultOrder.every(isId)
      || typeof counts !== "object" || counts === null || Array.isArray(counts)
      || !Object.entries(counts).every(([k, n]) => isId(k) && typeof n === "number" && Number.isInteger(n) && n >= 0)
    ) return null;
    return {
      version: 1,
      filter: { network: filter.network, channel: filter.channel },
      state: {
        version: 1,
        panels: panels as WallState["panels"],
        trendingCursor: state.trendingCursor as number,
        shuffleBag: state.shuffleBag as string[],
        vaultOrder: state.vaultOrder as string[],
        vaultCursor: state.vaultCursor as number,
        queuedCounts: counts as Record<string, number>,
      },
    };
  } catch {
    return null;
  }
}

export function loadSavedWall(storage: WallStorage | null): SavedWall | null {
  try {
    return storage ? parseSaved(storage.getItem(BANNED_VIDEO_STORAGE_KEY)) : null;
  } catch {
    return null;
  }
}

/** Returns false when storage is blocked or full; the wall keeps working in memory. */
export function saveWall(storage: WallStorage | null, saved: SavedWall): boolean {
  try {
    if (!storage) return false;
    storage.setItem(BANNED_VIDEO_STORAGE_KEY, JSON.stringify(saved));
    return true;
  } catch {
    return false;
  }
}

export function clearSavedWall(storage: WallStorage | null): void {
  try {
    storage?.removeItem(BANNED_VIDEO_STORAGE_KEY);
  } catch {
    // Storage blocked: nothing to clear.
  }
}
