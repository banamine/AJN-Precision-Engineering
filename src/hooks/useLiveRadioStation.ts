import { useEffect, useState } from "react";

export interface RadioStationInfo {
  id: string; name: string; number?: number; city?: string; region?: string; country: string;
  description?: string; genres: string[]; homepage?: string; logo?: string;
}
const cache = new Map<string, RadioStationInfo>();

/** Looks up one radio station's own details (number, logo, description) from the directory. Null while loading or if unknown. */
export function useLiveRadioStation(stationId: string | null | undefined): RadioStationInfo | null {
  const [info, setInfo] = useState<RadioStationInfo | null>(() => (stationId ? cache.get(stationId) ?? null : null));
  useEffect(() => {
    if (!stationId || !stationId.startsWith("radio:")) { setInfo(null); return; }
    const hit = cache.get(stationId);
    if (hit) { setInfo(hit); return; }
    setInfo(null);
    const ctl = new AbortController();
    fetch(`/api/live-radio/stations?ids=${encodeURIComponent(stationId)}&pageSize=1`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: { items?: RadioStationInfo[] }) => {
        const s = j.items?.find((x) => x.id === stationId);
        if (s) { cache.set(stationId, s); setInfo(s); }
      })
      .catch(() => { /* no panel is better than a wrong one */ });
    return () => ctl.abort();
  }, [stationId]);
  return info;
}
