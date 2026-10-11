import { useCallback, useEffect, useRef, useState } from "react";
import type { PlayProgramCallback } from "../types";

export type NewShow = {
  channelId: string;
  channelName: string;
  title: string;
  programId: string;
  description?: string;
  archivePath?: string;
  mediaUrl?: string;
  mediaType?: 'video' | 'audio';
  assetId?: string;
  sourceId?: string;
};
type VersionInfo = { version: number; fetchedAt: string | null; refreshing: boolean; newShows: NewShow[] };

const POLL_MS = 5 * 60_000;

/** Polite "Latest news ready" notice. The server refreshes TV News in the
 *  background; this polls a tiny version endpoint and never interrupts playback —
 *  the new shows are used only when the user presses Play. */
export function NewsReadyNotice({ onPlay }: { onPlay: PlayProgramCallback }) {
  const seenRef = useRef<number | null>(null);
  const [ready, setReady] = useState<VersionInfo | null>(null);
  const [loadingShowId, setLoadingShowId] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/news/version", { cache: "no-store" });
      if (!res.ok) return;
      const v: VersionInfo = await res.json();
      if (seenRef.current === null) { seenRef.current = v.version; return; } // baseline at app open
      if (v.version > seenRef.current && v.newShows.length) setReady(v);
    } catch { /* offline: try next poll */ }
  }, []);

  useEffect(() => {
    void poll();
    const t = window.setInterval(() => void poll(), POLL_MS);
    return () => window.clearInterval(t);
  }, [poll]);

  const dismiss = () => {
    if (ready) seenRef.current = ready.version;
    setReady(null);
    setPlayError(null);
  };

  const playShow = async (targetShow: NewShow) => {
    if (!targetShow || loadingShowId !== null) return;
    setLoadingShowId(targetShow.programId);
    setPlayError(null);

    window.dispatchEvent(new CustomEvent("ajn:schedule-updated", { detail: { guideId: "cable-tv" } }));

    try {
      let played = false;

      // 1. Attempt to resolve full schedule program so segments and guide context are loaded
      try {
        const res = await fetch("/api/schedule?guide=cable-tv");
        if (res.ok) {
          const data = await res.json();
          const ch = (data.channels ?? []).find((c: any) => c.id === targetShow.channelId);
          if (ch && Array.isArray(ch.programs) && ch.programs.length > 0) {
            const rawTargetAsset = targetShow.assetId || (
              targetShow.programId?.startsWith("program-")
                ? targetShow.programId.replace(/^program-/, "").replace(/:show$/, "")
                : undefined
            );

            // Match by assetId, title, or programId prefix, or channel's first slot
            const matched = ch.programs.find((x: any) => {
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
                matched.assetId || targetShow.assetId
              );
              played = true;
            }
          }
        }
      } catch (scheduleErr) {
        console.warn("[AJN News] could not load schedule for news show", scheduleErr);
      }

      // 2. If schedule did not return playable media, play targetShow directly if media path exists
      if (!played && (targetShow.archivePath || targetShow.mediaUrl)) {
        onPlay(
          targetShow.archivePath || targetShow.mediaUrl!,
          targetShow.title,
          targetShow.description || targetShow.channelName,
          targetShow.mediaType || "video",
          targetShow.channelId,
          "cable-tv",
          targetShow.programId,
          targetShow.sourceId,
          targetShow.assetId
        );
        played = true;
      }

      if (played) {
        dismiss();
      } else {
        setPlayError("Could not start broadcast. Please try again or open TV Guide.");
      }
    } catch (e: any) {
      console.error("[AJN News] could not play latest news show", e);
      setPlayError("Failed to initiate news playback.");
    } finally {
      setLoadingShowId(null);
    }
  };

  const playLatest = async () => {
    if (!ready || !ready.newShows.length) return;
    await playShow(ready.newShows[0]);
  };

  // Docked UNDER the top bar, never bottom-right: that corner belongs to the mini player.
  return (
    <div role="status" aria-live="polite" aria-atomic="true" data-testid="news-ready-dock" className="pointer-events-none fixed inset-x-0 top-14 z-30 flex justify-center px-3 pt-2 lg:top-[52px]">
      {ready && (
        <div className="pointer-events-auto w-full max-w-xl rounded-xl border border-sky-500/40 bg-neutral-900/95 p-3 text-sm shadow-xl backdrop-blur-md">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 basis-48 font-semibold text-sky-300">
              Latest news ready — {ready.newShows.length} new show{ready.newShows.length === 1 ? "" : "s"}
              {ready.fetchedAt && <span className="ml-2 text-xs font-normal text-neutral-400">fetched {new Date(ready.fetchedAt).toLocaleTimeString()}</span>}
            </p>
            <button
              type="button"
              onClick={() => void playLatest()}
              disabled={loadingShowId !== null}
              className="rounded bg-sky-600 px-3 py-1.5 font-semibold text-white hover:bg-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loadingShowId ? "Starting player..." : "Play latest news"}
            </button>
            <button
              type="button"
              onClick={() => setListOpen((o) => !o)}
              aria-expanded={listOpen}
              data-testid="news-ready-toggle"
              className="rounded px-2 py-1.5 text-neutral-300 hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-500"
            >
              {listOpen ? "Hide list" : "Show list"}
            </button>
            <button
              type="button"
              onClick={dismiss}
              disabled={loadingShowId !== null}
              className="rounded px-3 py-1.5 text-neutral-300 hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-500 disabled:opacity-60"
            >
              Later
            </button>
          </div>
          {listOpen && (
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-neutral-200">
              {ready.newShows.slice(0, 12).map((s) => (
                <li key={s.programId} className="truncate">
                  <button
                    type="button"
                    onClick={() => void playShow(s)}
                    disabled={loadingShowId !== null}
                    className="w-full cursor-pointer truncate text-left transition-colors hover:text-sky-300 focus:underline focus:outline-none disabled:opacity-60"
                    title={`Play: ${s.title}`}
                  >
                    <span className="text-neutral-400">{s.channelName}:</span> {s.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {playError && (
            <p className="mt-2 text-xs font-medium text-rose-400" role="alert">{playError}</p>
          )}
        </div>
      )}
    </div>
  );
}
