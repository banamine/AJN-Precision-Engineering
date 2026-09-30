import type { RumbleBaseline } from "./types";
import { validateBaseline } from "./logic";

const STORAGE_KEY = "rumble.baseline.version";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type FetchLike = typeof fetch;

function getStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export async function fetchRumbleBaseline(
  timeoutMs = 5000,
  fetchImpl: FetchLike = fetch,
  storage: StorageLike | null = getStorage(),
): Promise<{ changed: boolean; baseline: RumbleBaseline | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl("/api/rumble/baseline", { signal: controller.signal });
    if (!response.ok) return { changed: false, baseline: null };

    const payload = await response.json() as RumbleBaseline & { ok?: boolean };
    if (payload.ok === false) return { changed: false, baseline: null };

    const { valid } = validateBaseline(payload);
    if (!valid) return { changed: false, baseline: null };

    let previousVersion: number | null = null;
    try {
      const stored = storage?.getItem(STORAGE_KEY);
      previousVersion = stored === null || stored === undefined ? null : Number(stored);
      if (!Number.isFinite(previousVersion)) previousVersion = null;
    } catch {
      previousVersion = null;
    }

    const changed = previousVersion !== payload.version;

    try {
      storage?.setItem(STORAGE_KEY, String(payload.version));
    } catch {
      // Storage can be blocked by browser privacy settings.
    }

    return { changed, baseline: payload };
  } catch {
    return { changed: false, baseline: null };
  } finally {
    clearTimeout(timer);
  }
}
