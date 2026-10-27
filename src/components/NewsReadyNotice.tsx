import { useState } from "react";
import type { PlayProgramCallback } from "../types";
import type { NewShow, NewsReadySnapshot } from "../utils/newsReadyStore";

export type { NewShow } from "../utils/newsReadyStore";

type ScheduleProgram = {
  id?: string;
  title?: string;
  description?: string;
  archivePath?: string;
  mediaUrl?: string;
  mediaType?: "video" | "audio";
  channelId?: string;
  guideId?: string;
  sourceId?: string;
  assetId?: string;
};
type ScheduleChannel = { id?: string; programs?: ScheduleProgram[] };

/** Resolve a new-news entry to the guide's program (segments + guide context) and start it. */
async function startNewsShow(targetShow: NewShow, onPlay: PlayProgramCallback): Promise<boolean> {
  window.dispatchEvent(new CustomEvent("ajn:schedule-updated", { detail: { guideId: "cable-tv" } }));
  try {
    const res = await fetch("/api/schedule?guide=cable-tv");
    if (res.ok) {
      const data = (await res.json()) as { channels?: ScheduleChannel[] };
      const ch = (data.channels ?? []).find((c) => c.id === targetShow.channelId);
      if (ch && Array.isArray(ch.programs) && ch.programs.length > 0) {
        const rawTargetAsset = targetShow.assetId || (
          targetShow.programId?.startsWith("program-")
            ? targetShow.programId.replace(/^program-/, "").replace(/:show$/, "")
            : undefined
        );
        const matched = ch.programs.find((x) => {
          if (rawTargetAsset && x.assetId && x.assetId.includes(rawTargetAsset)) return true;
          if (targetShow.assetId && x.assetId === targetShow.assetId) return true;
          if (targetShow.title && x.title && x.title.trim().toLowerCase() === targetShow.title.trim().toLowerCase()) return true;
          if (targetShow.programId && String(x.id).startsWith(targetShow.programId.replace(/:show$/, ""))) return true;
          return false;
        }) || ch.programs[0];
        const playableSrc = matched?.archivePath || matched?.mediaUrl;
        if (matched && playableSrc) {
          onPlay(
            playableSrc,
            matched.title || targetShow.title,
            matched.description || targetShow.description,
            matched.mediaType || targetShow.mediaType || "video",
            matched.channelId || targetShow.channelId,
            matched.guideId || "cable-tv",
            matched.id,
            matched.sourceId || targetShow.sourceId,
            matched.assetId || targetShow.assetId,
          );
          return true;
        }
      }
    }
  } catch (scheduleErr) {
    console.warn("[AJN News] could not load schedule for news show", scheduleErr);
  }
  if (targetShow.archivePath || targetShow.mediaUrl) {
    onPlay(
      (targetShow.archivePath || targetShow.mediaUrl)!,
      targetShow.title,
      targetShow.description || targetShow.channelName,
      targetShow.mediaType || "video",
      targetShow.channelId,
      "cable-tv",
      targetShow.programId,
      targetShow.sourceId,
      targetShow.assetId,
    );
    return true;
  }
  return false;
}

/**
 * Body of the "News" status report. Rendered only after the user opens the
 * News indicator — it never appears on its own and never covers the player.
 */
export function NewsReadyReport({
  snapshot,
  onPlay,
  onSeen,
}: {
  snapshot: NewsReadySnapshot;
  onPlay?: PlayProgramCallback;
  onSeen: () => void;
}) {
  const [loadingShowId, setLoadingShowId] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const shows = snapshot.phase === "ready" ? snapshot.newShows : [];
  if (!shows.length) return null;

  const play = async (show: NewShow) => {
    if (!onPlay || loadingShowId !== null) return;
    setLoadingShowId(show.programId);
    setPlayError(null);
    try {
      const started = await startNewsShow(show, onPlay);
      if (started) onSeen();
      else setPlayError("Could not start that show. Try again or open the TV Guide.");
    } catch (e) {
      console.error("[AJN News] could not play latest news show", e);
      setPlayError("Failed to start news playback.");
    } finally {
      setLoadingShowId(null);
    }
  };

  return (
    <div data-testid="news-ready-report" className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-2">
        {onPlay && (
          <button
            type="button"
            onClick={() => void play(shows[0])}
            disabled={loadingShowId !== null}
            className="rounded bg-sky-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loadingShowId ? "Starting…" : "Play latest"}
          </button>
        )}
        <button
          type="button"
          onClick={onSeen}
          disabled={loadingShowId !== null}
          className="rounded border border-neutral-700 px-2.5 py-1 text-xs text-neutral-200 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 disabled:opacity-60"
        >
          Mark as seen
        </button>
      </div>
      <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs text-neutral-200" aria-label="New news shows">
        {shows.slice(0, 12).map((s) => (
          <li key={s.programId}>
            <button
              type="button"
              onClick={() => void play(s)}
              disabled={!onPlay || loadingShowId !== null}
              className="w-full truncate rounded px-1 py-0.5 text-left hover:bg-neutral-800 hover:text-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-60"
              title={`Play: ${s.title}`}
            >
              <span className="text-neutral-400">{s.channelName}:</span> {s.title}
            </button>
          </li>
        ))}
      </ul>
      {playError && <p className="text-xs font-medium text-rose-300" role="alert">{playError}</p>}
    </div>
  );
}
