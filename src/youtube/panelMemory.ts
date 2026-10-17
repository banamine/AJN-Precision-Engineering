import type { YoutubePlaylist } from "./types";
import {
  isYoutubePlaylist,
  isYoutubeRegistryId,
} from "./validate";

const STORAGE_KEY = "ajn.wall.youtube.v1";
const SHOWS_STORAGE_KEY = "youtube.shows.v1";
const PANEL_COUNT = 4;
const MAX_SHOW_STORE_CHARS = 48_000;
const MAX_ADDED_SHOWS = 100;

type PanelPickReader = Pick<Storage, "getItem">;
type PanelPickWriter = Pick<Storage, "setItem">;
type ShowStore = Pick<Storage, "getItem" | "setItem">;

function getBrowserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function loadPanelPicks(
  validIds: ReadonlySet<string>,
  storage?: PanelPickReader,
): string[] | null {
  try {
    const source = storage ?? getBrowserStorage();
    if (!source) return null;

    const raw = source.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed)
      || parsed.version !== 1
      || !Array.isArray(parsed.picks)
      || parsed.picks.length !== PANEL_COUNT
      || typeof parsed.savedAt !== "string"
      || !Number.isFinite(Date.parse(parsed.savedAt))
    ) {
      return null;
    }

    const seen = new Set<string>();
    const picks = parsed.picks.map((pick) => {
      if (typeof pick !== "string" || pick === "" || !validIds.has(pick) || seen.has(pick)) {
        return "";
      }
      seen.add(pick);
      return pick;
    });

    return picks.some(Boolean) ? picks : null;
  } catch {
    return null;
  }
}

export function savePanelPicks(
  picks: readonly string[],
  storage?: PanelPickWriter,
): boolean {
  try {
    if (picks.length !== PANEL_COUNT || picks.some((pick) => typeof pick !== "string")) {
      return false;
    }
    const target = storage ?? getBrowserStorage();
    if (!target) return false;
    target.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      picks,
      savedAt: new Date().toISOString(),
    }));
    return true;
  } catch {
    return false;
  }
}

function getShowStore(storage?: ShowStore): {
  source: ShowStore;
  channels: Record<string, unknown>;
} | null {
  try {
    const source = storage ?? getBrowserStorage();
    if (!source) return null;
    const raw = source.getItem(SHOWS_STORAGE_KEY);
    if (raw === null || raw.length > MAX_SHOW_STORE_CHARS) {
      return { source, channels: {} };
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)
      || parsed.version !== 1
      || !isRecord(parsed.channels)
      || typeof parsed.savedAt !== "string"
      || !Number.isFinite(Date.parse(parsed.savedAt))) {
      return { source, channels: {} };
    }
    return { source, channels: parsed.channels };
  } catch {
    return null;
  }
}

export function loadAddedShows(
  registryId: string,
  seededShows: readonly YoutubePlaylist[],
  storage?: ShowStore,
): YoutubePlaylist[] {
  if (!isYoutubeRegistryId(registryId)) return [];
  const store = getShowStore(storage);
  if (!store) return [];
  const rawShows = store.channels[registryId];
  if (!Array.isArray(rawShows)) return [];
  const seen = new Set(seededShows.map((show) => show.id));
  const result: YoutubePlaylist[] = [];
  for (const show of rawShows) {
    if (!isYoutubePlaylist(show) || seen.has(show.id)) continue;
    seen.add(show.id);
    result.push(show);
    if (result.length >= MAX_ADDED_SHOWS) break;
  }
  return result;
}

export function saveAddedShow(
  registryId: string,
  show: YoutubePlaylist,
  seededShows: readonly YoutubePlaylist[],
  storage?: ShowStore,
): boolean {
  if (!isYoutubeRegistryId(registryId) || !isYoutubePlaylist(show)) return false;
  const store = getShowStore(storage);
  if (!store) return false;
  const existing = loadAddedShows(registryId, seededShows, store.source);
  if (seededShows.some((seeded) => seeded.id === show.id)
    || existing.some((added) => added.id === show.id)
    || existing.length >= MAX_ADDED_SHOWS) {
    return false;
  }
  const channels = { ...store.channels, [registryId]: [...existing, show] };
  const serialized = JSON.stringify({
    version: 1,
    channels,
    savedAt: new Date().toISOString(),
  });
  if (serialized.length > MAX_SHOW_STORE_CHARS) return false;
  try {
    store.source.setItem(SHOWS_STORAGE_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}
