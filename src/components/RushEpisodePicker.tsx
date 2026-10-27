import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Loader2 } from "lucide-react";
import type { PlayProgramCallback } from "../types";
import { hasSeenRushPreludeToday, loadRushSettings, RUSH_PRELUDE_SEEN_EVENT, saveRushSettings } from "../utils/rushSettings";

type Role = "morning-update" | "full-show";
type IndexEntry = { id: string; date: string; year: number; role: Role };
type Track = { file: string; durationSeconds: number; archivePath: string; mediaUrl: string };
type Episode = IndexEntry & {
  kind: "video" | "audio";
  tracks?: Track[];
  unavailable?: { reason: string };
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FIRST_YEAR = 2005, LAST_YEAR = 2017;
const fmtDur = (s: number) => `${Math.floor(s / 60)} min`;

/** Rush Limbaugh episode picker: a year at a glance, one cell per day, lit where
 *  an episode exists. Picking a day resolves that episode's hours on the server. */
export function RushEpisodePicker({ onPlay }: { onPlay: PlayProgramCallback }) {
  const [year, setYear] = useState(2008);
  const [dates, setDates] = useState<Set<string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<Episode[] | null>(null);
  const [loadingEp, setLoadingEp] = useState(false);
  const [continueAcross, setContinueAcross] = useState(() => loadRushSettings().continueAcrossDates);
  const [preludeSeenToday, setPreludeSeenToday] = useState(() => hasSeenRushPreludeToday());

  useEffect(() => {
    const refresh = () => setPreludeSeenToday(hasSeenRushPreludeToday());
    globalThis.addEventListener?.(RUSH_PRELUDE_SEEN_EVENT, refresh);
    globalThis.addEventListener?.("storage", refresh);
    return () => {
      globalThis.removeEventListener?.(RUSH_PRELUDE_SEEN_EVENT, refresh);
      globalThis.removeEventListener?.("storage", refresh);
    };
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    setDates(null); setError(null);
    fetch(`/api/rush/index?year=${year}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setDates(new Set((d.items as IndexEntry[]).map((e) => e.date))))
      .catch((e) => { if (e.name !== "AbortError") setError(`Episode list unavailable (${e.message})`); });
    return () => ctrl.abort();
  }, [year]);

  const pick = async (date: string) => {
    setPicked(date); setEpisodes(null); setLoadingEp(true); setError(null);
    try {
      const r = await fetch(`/api/rush/episode/${date}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      const items = d.episodes as Episode[];
      setEpisodes(items);
      const morningUpdate = items.find((episode) => episode.role === "morning-update");
      const full = items.find((episode) => episode.role === "full-show");
      if (morningUpdate && !morningUpdate.unavailable && morningUpdate.tracks?.length && !hasSeenRushPreludeToday()) {
        playPreludeOrHourOne(morningUpdate, full);
      } else if (full?.tracks?.[0]) {
        playHour(full, full.tracks[0], 1);
      }
    } catch (e) { setError(`Could not load ${date}: ${e instanceof Error ? e.message : e}`); }
    finally { setLoadingEp(false); }
  };

  const months = useMemo(() => MONTHS.map((name, m) => {
    const days = new Date(Date.UTC(year, m + 1, 0)).getUTCDate();
    return { name, cells: Array.from({ length: days }, (_, i) => `${year}-${String(m + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`) };
  }), [year]);

  function playHour(ep: Episode, track: Track, hour: number) {
    onPlay(track.archivePath, `Rush Limbaugh — ${ep.date} (Hour ${hour})`, "The Rush Limbaugh Show",
      "audio", "rush-vod", "audio-podcasts", `rush-vod-${ep.date}-h${hour}`);
  }

  function playPreludeOrHourOne(prelude: Episode, fullShow?: Episode) {
    if (hasSeenRushPreludeToday()) {
      const firstHour = fullShow?.tracks?.[0];
      if (fullShow && firstHour) playHour(fullShow, firstHour, 1);
      return;
    }
    const track = prelude.tracks?.[0];
    if (!track || prelude.unavailable) return;
    onPlay(track.archivePath, `Rush Limbaugh — ${prelude.date} (Morning Update)`, "Rush Limbaugh Morning Update",
      "video", "rush-vod", "audio-podcasts", `rush-vod-${prelude.date}-morning-update`);
  }

  const prelude = episodes?.find((episode) => episode.role === "morning-update");
  const fullShow = episodes?.find((episode) => episode.role === "full-show");
  return (
    <section aria-labelledby="rush-picker-title" className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="rush-picker-title" className="flex items-center gap-2 text-sm font-semibold text-neutral-100">
          <CalendarDays className="h-4 w-4 text-amber-400" aria-hidden="true" /> Rush Limbaugh Show — pick a date
        </h2>
        <label className="flex items-center gap-2 text-xs text-neutral-400" title="After a day's last hour, keep playing the next available date">
          <input type="checkbox" checked={continueAcross} data-testid="rush-continue-toggle"
            onChange={(e) => { setContinueAcross(e.target.checked); saveRushSettings({ continueAcrossDates: e.target.checked }); }}
            className="accent-amber-400" />
          Continue to next date
        </label>
        <label className="flex items-center gap-2 text-xs text-neutral-400">
          Year
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-100">
            {Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
      </div>

      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      {!dates && !error && <p className="text-xs text-neutral-500">Loading episode list…</p>}
      {dates && (
        <div className="overflow-x-auto">
          <div className="min-w-[640px] space-y-1">
            {months.map((mo) => (
              <div key={mo.name} className="flex items-center gap-1">
                <span className="w-8 shrink-0 text-[10px] font-mono text-neutral-500">{mo.name}</span>
                {mo.cells.map((d) => {
                  const has = dates.has(d);
                  return (
                    <button key={d} type="button" disabled={!has} onClick={() => void pick(d)}
                      aria-label={has ? `Play episode ${d}` : `${d}: no episode`} title={d}
                      className={`h-4 w-4 shrink-0 rounded-sm transition ${has ? (picked === d ? "bg-amber-400" : "bg-blue-600 hover:bg-blue-400 cursor-pointer") : "bg-neutral-800 cursor-default"} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300`} />
                  );
                })}
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-neutral-500">{dates.size} episodes in {year}. Blue = available.</p>
        </div>
      )}

      {loadingEp && <p className="flex items-center gap-2 text-xs text-neutral-400"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading {picked}…</p>}
      {episodes && picked && (
        <section className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-950/60 p-3" aria-label={`Rush items for ${picked}`}>
          <h3 className="text-xs font-semibold text-neutral-200">{picked}</h3>
          {prelude && (
            <div data-testid="rush-prelude-row" className="flex flex-wrap items-center gap-3 border-b border-neutral-800 pb-3">
              <span className="text-xs font-semibold text-neutral-200">Morning Update</span>
              {prelude.unavailable || !prelude.tracks?.length ? (
                <span role="status" className="text-xs text-neutral-400">Morning Update unavailable</span>
              ) : preludeSeenToday ? (
                <span role="status" className="text-xs text-neutral-400">Morning Update already played today</span>
              ) : (
                <button type="button" data-testid="rush-play-prelude" onClick={() => playPreludeOrHourOne(prelude, fullShow)}
                  className="min-h-11 rounded-md bg-amber-500 px-4 py-2 text-xs font-semibold text-neutral-950 hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300">
                  Play Morning Update
                </button>
              )}
            </div>
          )}
          {fullShow?.tracks?.length ? (
            <div data-testid="rush-full-show-row" className="flex flex-wrap items-center gap-2">
              {fullShow.tracks.map((track, index) => (
                <button key={track.file} type="button" onClick={() => playHour(fullShow, track, index + 1)}
                  className="min-h-11 rounded-md bg-amber-500 px-4 py-2 text-xs font-semibold text-neutral-950 hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300">
                  ▶ Hour {index + 1} · {fmtDur(track.durationSeconds)}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-neutral-500">No full show hours are indexed for this date.</p>
          )}
        </section>
      )}
    </section>
  );
}
