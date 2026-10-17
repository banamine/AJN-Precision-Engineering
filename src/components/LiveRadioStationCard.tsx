import { useState } from "react";
import { useLiveRadioStation } from "../hooks/useLiveRadioStation";

const initialsOf = (n: string): string => n.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "♪";

/** The station's own identity on the radio stage: logo (or initials), #number, place, genres and its own description. */
export function LiveRadioStationCard({ stationId }: { stationId: string | null | undefined }) {
  const s = useLiveRadioStation(stationId);
  const [broken, setBroken] = useState<string | null>(null);
  if (!s) return null;
  const where = [s.city, s.region].filter(Boolean).join(", ") || s.country;
  const showLogo = s.logo && broken !== s.id;
  return (
    <div data-testid="radio-station-card" className="flex shrink-0 items-center gap-3 rounded-md border border-neutral-700/80 bg-neutral-900/80 p-2">
      {showLogo
        ? <img src={s.logo} alt="" referrerPolicy="no-referrer" draggable={false} className="h-14 w-14 shrink-0 rounded-lg bg-neutral-900 object-contain"
            onError={() => setBroken(s.id)} onLoad={(e) => { if (e.currentTarget.naturalWidth < 24) setBroken(s.id); }} />
        : <div aria-hidden="true" data-testid="radio-station-card-initials" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-neutral-800 text-lg font-bold text-neutral-200">{initialsOf(s.name)}</div>}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {typeof s.number === "number" && <span data-testid="radio-station-card-number" className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[11px] font-bold text-amber-300">#{s.number}</span>}
          <span className="truncate text-sm font-semibold text-white">{s.name}</span>
        </div>
        <div className="truncate text-xs text-neutral-400">{[where, s.genres.slice(0, 3).join(" · ")].filter(Boolean).join(" · ")}</div>
        {s.description && <div className="line-clamp-2 text-xs text-neutral-300">{s.description}</div>}
      </div>
      {s.homepage && <a href={s.homepage} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-sky-300 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">Website</a>}
    </div>
  );
}
