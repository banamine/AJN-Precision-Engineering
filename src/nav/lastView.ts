export const LAST_VIEW_KEY = "ajn.nav.v1";
export const VALID_DESTINATIONS = ["home", "tv-guide", "player", "library", "search", "news", "radio", "today", "history", "dev"];

export interface LastView {
  version: 1;
  destination: string;
  guideId: string | null;
  scrollY: number;
  scrollX: number;
  savedAt: number;
}

export interface LastViewStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function parseLastView(raw: string | null): LastView | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const view = value as Record<string, unknown>;
    if (
      view.version !== 1
      || typeof view.destination !== "string"
      || !(view.guideId === null || typeof view.guideId === "string")
      || typeof view.scrollY !== "number" || !Number.isFinite(view.scrollY) || view.scrollY < 0
      || typeof view.scrollX !== "number" || !Number.isFinite(view.scrollX) || view.scrollX < 0
      || typeof view.savedAt !== "number" || !Number.isFinite(view.savedAt)
    ) return null;
    return {
      version: 1,
      destination: view.destination,
      guideId: view.guideId as string | null,
      scrollY: view.scrollY,
      scrollX: view.scrollX,
      savedAt: view.savedAt,
    };
  } catch {
    return null;
  }
}

export function loadLastView(validDestinations: string[], storage?: LastViewStorage): LastView | null {
  try {
    // Resolve the default inside the try: even the localStorage getter can throw.
    const target = storage ?? (typeof window === "undefined" ? null : window.localStorage);
    if (!target) return null;
    const view = parseLastView(target.getItem(LAST_VIEW_KEY));
    return view && validDestinations.includes(view.destination) ? view : null;
  } catch {
    return null;
  }
}

export function saveLastView(partial: Partial<Omit<LastView, "version">>, storage?: LastViewStorage): void {
  try {
    const target = storage ?? (typeof window === "undefined" ? null : window.localStorage);
    if (!target) return;
    const previous = parseLastView(target.getItem(LAST_VIEW_KEY));
    const now = Date.now();
    const view: LastView = {
      version: 1,
      destination: "home",
      guideId: null,
      scrollY: 0,
      scrollX: 0,
      savedAt: now,
      ...previous,
      ...partial,
    };
    // Destination/guide-only writes must not make an old horizontal scroll fresh.
    view.savedAt = partial.savedAt
      ?? (partial.scrollY !== undefined || partial.scrollX !== undefined ? now : previous?.savedAt ?? now);
    target.setItem(LAST_VIEW_KEY, JSON.stringify(view));
  } catch {
    // Navigation and scrolling continue when storage is blocked.
  }
}
