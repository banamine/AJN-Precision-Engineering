export const START_GUIDE_KEY = 'ajn.startGuide.v1';

export interface StartGuideStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface StartGuidePref {
  version: 1;
  dontAutoOpen: boolean;
}

function defaultPref(): StartGuidePref {
  return { version: 1, dontAutoOpen: false };
}

function getDefaultStorage(): StartGuideStorage | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function loadStartGuidePref(storage?: StartGuideStorage): StartGuidePref {
  const store = storage ?? getDefaultStorage();
  if (!store) return defaultPref();
  try {
    const raw = store.getItem(START_GUIDE_KEY);
    if (!raw) return defaultPref();
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const value = parsed as Record<string, unknown>;
      if (value.version === 1 && typeof value.dontAutoOpen === 'boolean') {
        return { version: 1, dontAutoOpen: value.dontAutoOpen };
      }
    }
  } catch {
    // Corrupt JSON or a storage read error falls back to the default.
  }
  return defaultPref();
}

export function saveStartGuidePref(pref: StartGuidePref, storage?: StartGuideStorage): void {
  const store = storage ?? getDefaultStorage();
  if (!store) return;
  try {
    store.setItem(START_GUIDE_KEY, JSON.stringify(pref));
  } catch {
    // Storage may be unavailable; the guide still works.
  }
}

export function shouldAutoOpen(pref: StartGuidePref, hasHash: boolean): boolean {
  return !pref.dontAutoOpen && !hasHash;
}
