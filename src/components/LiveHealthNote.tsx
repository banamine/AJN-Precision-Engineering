import { useEffect, useState } from "react";

type Health = { checked: number; ok: number; offline: number; lastRun: string | null; running: boolean; skippedRun: boolean; plutoEpg?: { channels: number; lastOk: string | null } };

/** One line under the Live TV guide: how many channels are hidden as offline. */
export function LiveHealthNote() {
  const [h, setH] = useState<Health | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/live/health", { signal: ctrl.signal }).then((r) => (r.ok ? r.json() : null)).then(setH).catch(() => {});
    return () => ctrl.abort();
  }, []);
  if (!h) return null;
  const when = h.lastRun ? new Date(h.lastRun).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
  return (
    <p className="text-xs text-neutral-500" data-testid="live-health-note" aria-live="polite">
      {h.lastRun
        ? `${h.offline} offline channel${h.offline === 1 ? "" : "s"} hidden · ${h.ok} answering (checked ${when})`
        : h.running ? "Checking which channels are on the air…" : "Channel check runs shortly after the list loads."}
      {h.plutoEpg?.channels ? ` · Pluto listings for ${h.plutoEpg.channels} channels` : ""}
    </p>
  );
}
