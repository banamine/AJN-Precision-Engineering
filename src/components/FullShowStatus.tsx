import { useSyncExternalStore } from "react";
import { getShowQueue, subscribeShowQueue } from "../utils/showQueue";

/** "Full show · Part 2 of 4" plus an honest list of parts that were unavailable. Renders nothing when no Full Show is active. */
export function FullShowStatus({ className = "" }: { className?: string }) {
  const q = useSyncExternalStore(subscribeShowQueue, getShowQueue, getShowQueue);
  if (!q) return null;
  const item = q.plan.items[q.index];
  const media = item.mediaType === "video" ? "video" : "audio";
  return (
    <div data-testid="full-show-status" role="status" className={`rounded-lg border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-xs text-neutral-200 ${className}`}>
      <div className="font-semibold text-sky-200">
        Full show · {q.label} · recorded {media}{q.plan.singleFile ? " · one continuous file" : ` · part ${item.partNo} of ${item.totalParts}`}
      </div>
      {q.plan.missingHours.length > 0 && (
        <div data-testid="full-show-missing" className="mt-1 text-amber-300">
          Not published as {media}: hour {q.plan.missingHours.join(", ")}. This is not the complete show.
        </div>
      )}
      {q.failed.length > 0 && (
        <div data-testid="full-show-failed" className="mt-1 text-red-300">Could not play part {q.failed.join(", ")}; moved on to the next part.</div>
      )}
    </div>
  );
}
