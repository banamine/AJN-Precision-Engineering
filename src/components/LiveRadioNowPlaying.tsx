import { useState } from "react";
import { Music } from "lucide-react";
import { useLiveRadioNowPlaying } from "../hooks/useLiveRadioNowPlaying";

/** Compact "now playing" strip from the station's own feed. Renders nothing for stations without a verified feed. */
export function LiveRadioNowPlaying({ stationId, logoUrl }: { stationId: string | null | undefined; logoUrl?: string | null }) {
  const np = useLiveRadioNowPlaying(stationId);
  const [artFailed, setArtFailed] = useState<string | null>(null);
  if (np.state === "unsupported" || np.state === "loading") return null;
  const c = np.current;
  const art = c?.artUrl && artFailed !== c.artUrl ? c.artUrl : logoUrl && !(c?.artUrl) ? logoUrl : logoUrl ?? null;
  let line1 = "", line2 = "";
  if (c) { line1 = c.title; line2 = c.artist; }
  else if (np.state === "none") { line1 = "No song right now"; line2 = "Talk, news or ad break"; }
  else { line1 = "Song info unavailable"; line2 = np.reason ?? ""; }
  return (
    <div data-testid="live-radio-nowplaying" data-state={np.state} className="shrink-0 rounded-md border border-neutral-700/80 bg-neutral-900/80 p-1.5">
    <div className="flex items-center gap-2">
      <div className="h-10 w-10 shrink-0 overflow-hidden rounded bg-neutral-800">
        {art ? <img src={art} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" onError={() => c?.artUrl && setArtFailed(c.artUrl)} />
             : <Music className="m-2.5 h-5 w-5 text-neutral-500" aria-hidden="true" />}
      </div>
      <div className="min-w-0 flex-1" aria-live="polite">
        <div className="text-[10px] uppercase tracking-wide text-neutral-400">{np.state === "stale" ? "Last song" : c ? "Now playing" : "On air"}</div>
        <div className="truncate text-sm font-medium text-white">{line1}</div>
        {line2 && <div className="truncate text-xs text-neutral-300">{line2}</div>}
        {np.refreshFailed && c && <div className="text-[10px] text-amber-400">Couldn't refresh · showing last known</div>}
      </div>
    </div>
    {np.recent.length > 0 && (
      <details open data-testid="live-radio-recent" className="mt-1.5 border-t border-neutral-800 pt-1">
        <summary className="cursor-pointer select-none text-[10px] uppercase tracking-wide text-neutral-400">Recently played</summary>
        <ul className="m-0 mt-1 list-none space-y-0.5 p-0">
          {np.recent.map((r, i) => (
            <li key={`${r.artist}|${r.title}|${i}`} className="flex items-baseline justify-between gap-2 text-xs">
              <span className="min-w-0 truncate text-neutral-200">{r.artist ? `${r.artist} – ` : ""}{r.title}</span>
              {r.playedLabel && <span className="shrink-0 text-[10px] text-neutral-500">{r.playedLabel}</span>}
            </li>
          ))}
        </ul>
      </details>
    )}
    </div>
  );
}
