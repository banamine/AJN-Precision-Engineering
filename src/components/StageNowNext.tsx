import { useLiveRadioNowPlaying } from "../hooks/useLiveRadioNowPlaying";

/** Large "Up next" card for the Archive Music stage. Real queue data only; renders nothing when there is no next track. */
export function StageUpNext({ title, artist }: { title: string; artist?: string }) {
  if (!title) return null;
  return (
    <div data-testid="stage-up-next" className="pointer-events-none absolute inset-x-4 bottom-3 z-[3] sm:inset-x-8">
      <div className="max-w-xl rounded-xl border border-pink-400/50 bg-slate-950/85 px-4 py-2.5">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-pink-300">Up next</p>
        <p className="truncate text-lg font-semibold leading-snug text-white sm:text-xl">{title}</p>
        {artist ? <p className="truncate text-sm text-slate-300">{artist}</p> : null}
      </div>
    </div>
  );
}

/**
 * Live radio stage info: station name, the station's own current song (when its feed has one) and the last songs played.
 * Live streams have no schedule, so there is no "Up next" here and none is invented.
 */
export function StageLiveRadioInfo({ stationId, stationName }: { stationId: string; stationName: string }) {
  const np = useLiveRadioNowPlaying(stationId);
  const song = np.current && (np.current.title || np.current.artist) ? np.current : null;
  const earlier = np.recent.filter((r) => r.title || r.artist).slice(0, 3);
  return (
    <div data-testid="stage-live-info" className="pointer-events-none absolute inset-x-4 bottom-3 top-14 z-[3] flex flex-col justify-between gap-3 sm:inset-x-8">
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-300">Now playing</p>
        {song ? (
          <>
            <p data-testid="stage-live-title" className="mt-1 line-clamp-2 text-2xl font-semibold leading-tight text-white sm:text-3xl">{song.title || "Unknown title"}</p>
            {song.artist ? <p data-testid="stage-live-artist" className="mt-1 truncate text-lg text-slate-200">{song.artist}</p> : null}
          </>
        ) : (
          <p data-testid="stage-live-nosong" className="mt-1 text-xl font-semibold text-white sm:text-2xl">
            {np.state === "loading" ? "Checking song info…" : "No song info from this station"}
          </p>
        )}
        <p className="mt-1 truncate text-sm text-slate-400">{stationName}</p>
      </div>
      {earlier.length > 0 && (
        <div className="hidden max-w-sm rounded-xl border border-slate-600/70 bg-slate-950/85 px-3 py-2 sm:block">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Earlier</p>
          <ul className="mt-1 space-y-0.5">
            {earlier.map((r, i) => (
              <li key={`${r.title}-${r.artist}-${i}`} className="truncate text-sm text-slate-200">{r.title}{r.artist ? ` · ${r.artist}` : ""}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
