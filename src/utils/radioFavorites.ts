import { useEffect, useState } from "react";

/** The single home for live-radio favorites (the same key the Radio directory always used). */
export const RADIO_FAVORITES_KEY = "ajn-live-radio-favorites-v1";
const EVENT = "ajn-radio-favorites-changed";

export function loadRadioFavorites(): Set<string> {
  try {
    const raw = window.localStorage.getItem(RADIO_FAVORITES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function saveRadioFavorites(ids: Set<string>): void {
  try { window.localStorage.setItem(RADIO_FAVORITES_KEY, JSON.stringify([...ids])); } catch { /* storage unavailable: lasts for this visit only */ }
  try { window.dispatchEvent(new Event(EVENT)); } catch { /* no window */ }
}

export function toggleRadioFavorite(id: string): boolean {
  const next = loadRadioFavorites();
  const added = !next.has(id);
  if (added) next.add(id); else next.delete(id);
  saveRadioFavorites(next);
  return added;
}

/** Live set of radio favorites; every heart (directory card, player) reads and writes the same list. */
export function useRadioFavorites(): Set<string> {
  const [ids, setIds] = useState<Set<string>>(() => loadRadioFavorites());
  useEffect(() => {
    const sync = (): void => setIds(loadRadioFavorites());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);
  return ids;
}
