import { useLiveRadioNowPlaying } from "../hooks/useLiveRadioNowPlaying";
import { useLiveRadioStation } from "../hooks/useLiveRadioStation";
import "./radio109.css";

/** True for the Classic Hits 109 stations (the only ones that get the glass skin). */
export const isClassicHits109 = (stationId: string | null | undefined): boolean => Boolean(stationId && stationId.startsWith("radio:ch109-"));

/** Classic Hits 109 station text on the radio stage: translucent glass panels so the live bars show through.
 *  Everything shown comes from the station record and the station's own song feed; nothing is invented. */
export function Radio109Glass({ stationId, playing }: { stationId: string | null | undefined; playing: boolean }) {
  const s = useLiveRadioStation(stationId);
  const np = useLiveRadioNowPlaying(stationId);
  const c = np.current;
  const where = s ? [s.city, s.region].filter(Boolean).join(", ") || s.country : "";
  const hasFeed = np.state !== "unsupported" && np.state !== "loading";
  let song = "", artist = "";
  if (c) { song = c.title; artist = c.artist; }
  else if (np.state === "none") { song = "No song right now"; artist = "Talk, news or ad break"; }
  else if (hasFeed) { song = "Song info unavailable"; artist = np.reason ?? ""; }
  const kicker = np.state === "stale" ? "Last song" : c ? "Now playing" : "On air";
  return (
    <div data-testid="radio-109-glass" data-state={np.state} className="r109 shrink-0">
      <section className="r109-glass" aria-label="Station and now playing">
        <div className="r109-top">
          <div className="r109-disc" data-playing={playing ? "true" : "false"} data-testid="radio-109-disc" aria-hidden="true"><span>109</span></div>
          <div className="min-w-0 flex-1" aria-live="polite">
            {hasFeed && <div className="r109-kicker"><i className="r109-dot" />{kicker}</div>}
            {hasFeed
              ? <><h3 className="r109-song">{song}</h3>{artist && <div className="r109-artist">{artist}</div>}</>
              : <h3 className="r109-song">{s?.name ?? "Classic Hits 109"}</h3>}
            {np.refreshFailed && c && <div className="r109-foot" style={{ color: "#ffb454" }}>Couldn't refresh · showing last known</div>}
          </div>
        </div>
        {s && (
          <div className="r109-meta">
            {typeof s.number === "number" && <b>#{s.number}</b>}
            <span className="font-semibold">{s.name}</span>{where ? ` · ${where}` : ""}{s.genres.length ? ` · ${s.genres.slice(0, 2).join(" · ")}` : ""}
          </div>
        )}
      </section>
      {np.recent.length > 0 && (
        <section className="r109-glass" aria-label="Recently played" data-testid="radio-109-recent">
          <h3 className="r109-h">Recently Played</h3>
          <ul className="r109-list">
            {np.recent.slice(0, 5).map((r, i) => (
              <li key={`${r.artist}|${r.title}|${i}`} className={i >= 3 ? "r109-extra" : undefined}>
                <span>{r.artist ? `${r.artist} – ` : ""}{r.title}</span>
                {r.playedLabel && <span>{r.playedLabel}</span>}
              </li>
            ))}
          </ul>
          <div className="r109-foot">Song text comes from the station's own feed, refreshed every 30 s.</div>
        </section>
      )}
    </div>
  );
}
