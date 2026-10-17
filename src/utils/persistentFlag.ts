import { useCallback, useState } from "react";

/** Boolean preference kept in localStorage; every access is guarded (storage can be blocked or absent). */
export function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

export function usePersistentFlag(key: string, fallback: boolean): [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
  const [value, setValue] = useState(() => readFlag(key, fallback));
  const set = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    setValue((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      try { window.localStorage.setItem(key, resolved ? "1" : "0"); } catch { /* storage unavailable: preference lasts this session only */ }
      return resolved;
    });
  }, [key]);
  return [value, set];
}
