import { validateBaseline } from "../rumble/logic";
import type { RumbleBaseline } from "../rumble/types";

export const OVERRIDE_KEY = "rumble.baseline.override.v1";
const MAX_CHARS = 400_000;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The list the user applied in this browser, or null (missing, blocked storage, or invalid). */
export function loadOverride(storage: StorageLike | null = defaultStorage()): RumbleBaseline | null {
  try {
    const raw = storage?.getItem(OVERRIDE_KEY);
    if (!raw || raw.length > MAX_CHARS) return null;
    const parsed = JSON.parse(raw) as RumbleBaseline;
    return validateBaseline(parsed).valid ? parsed : null;
  } catch {
    return null;
  }
}

/** Returns false when the browser refused to store it (the list still works for this visit). */
export function saveOverride(baseline: RumbleBaseline, storage: StorageLike | null = defaultStorage()): boolean {
  try {
    const text = JSON.stringify(baseline);
    if (!storage || text.length > MAX_CHARS) return false;
    storage.setItem(OVERRIDE_KEY, text);
    return true;
  } catch {
    return false;
  }
}

export function clearOverride(storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.removeItem(OVERRIDE_KEY);
  } catch {
    // storage blocked: nothing to clear
  }
}

/** Newest by generatedAt wins (later entries win ties), so a newer built-in list is never hidden by an old saved one. */
export function chooseBaseline(candidates: ReadonlyArray<RumbleBaseline | null>): RumbleBaseline {
  const valid = candidates.filter((entry): entry is RumbleBaseline => entry !== null);
  return valid.reduce((best, entry) => (Date.parse(entry.generatedAt) >= Date.parse(best.generatedAt) ? entry : best));
}
