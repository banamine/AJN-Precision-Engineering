import { useEffect, useState } from "react";

export interface RadioSong { artist: string; title: string; artUrl: string | null }
export interface RadioRecent { artist: string; title: string; playedLabel: string | null }
export interface LiveRadioNowPlaying {
  recent: RadioRecent[];
  state: "loading" | "ok" | "stale" | "none" | "error" | "unsupported";
  current: RadioSong | null;
  reason: string | null;
  /** True when the latest refresh failed and `current` is the last good value. */
  refreshFailed: boolean;
}
const POLL_MS = 30_000;
const INITIAL: LiveRadioNowPlaying = { recent: [], state: "loading", current: null, reason: null, refreshFailed: false };

/** Polls the station's own song feed via /api/live-radio/nowplaying. Only while mounted and the tab is visible; stops on "unsupported". */
export function useLiveRadioNowPlaying(stationId: string | null | undefined): LiveRadioNowPlaying {
  const [value, setValue] = useState<LiveRadioNowPlaying>(INITIAL);
  useEffect(() => {
    setValue(INITIAL);
    if (!stationId || !stationId.startsWith("radio:")) { setValue({ ...INITIAL, state: "unsupported" }); return; }
    let alive = true, timer: number | undefined, ctl: AbortController | null = null;
    const tick = async () => {
      if (document.visibilityState === "hidden") { schedule(); return; }
      ctl = new AbortController();
      try {
        const r = await fetch(`/api/live-radio/nowplaying?id=${encodeURIComponent(stationId)}`, { signal: ctl.signal });
        const j = await r.json();
        if (!alive) return;
        if (j.state === "unsupported") { setValue({ recent: [], state: "unsupported", current: null, reason: j.reason ?? null, refreshFailed: false }); return; }
        if (j.state === "ok" || j.state === "stale") {
          const c = j.current;
          const recent: RadioRecent[] = Array.isArray(j.recent) ? j.recent.slice(0, 5).map((x: any) => ({ artist: String(x?.artist ?? ""), title: String(x?.title ?? ""), playedLabel: x?.playedLabel ?? null })).filter((x: RadioRecent) => x.title) : [];
          setValue({ recent, state: j.state, current: c ? { artist: String(c.artist ?? ""), title: String(c.title ?? ""), artUrl: c.artUrl ?? null } : null, reason: null, refreshFailed: false });
        } else if (j.state === "none") {
          setValue({ recent: Array.isArray(j.recent) ? j.recent.slice(0, 5).map((x: any) => ({ artist: String(x?.artist ?? ""), title: String(x?.title ?? ""), playedLabel: x?.playedLabel ?? null })).filter((x: RadioRecent) => x.title) : [], state: "none", current: null, reason: j.reason ?? null, refreshFailed: false });
        } else {
          setValue((v) => ({ recent: v.recent, state: v.current ? v.state : "error", current: v.current, reason: j.reason ?? "feed error", refreshFailed: true }));
        }
      } catch (e) {
        if (!alive || (e as Error).name === "AbortError") return;
        setValue((v) => ({ recent: v.recent, state: v.current ? v.state : "error", current: v.current, reason: "couldn't reach the server", refreshFailed: true }));
      }
      schedule();
    };
    const schedule = () => { if (alive) timer = window.setTimeout(tick, POLL_MS); };
    void tick();
    return () => { alive = false; if (timer) window.clearTimeout(timer); ctl?.abort(); };
  }, [stationId]);
  return value;
}
