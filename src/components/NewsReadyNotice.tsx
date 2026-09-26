import { useCallback, useEffect, useRef, useState } from "react";
import type { PlayProgramCallback } from "../types";

type NewShow = { channelId: string; channelName: string; title: string; programId: string };
type VersionInfo = { version: number; fetchedAt: string | null; refreshing: boolean; newShows: NewShow[] };

const POLL_MS = 5 * 60_000;

/** Polite "Latest news ready" notice. The server refreshes TV News in the
 *  background; this polls a tiny version endpoint and never interrupts playback —
 *  the new shows are used only when the user presses Play. */
export function NewsReadyNotice({ onPlay }: { onPlay: PlayProgramCallback }) {
  const seenRef = useRef<number | null>(null);
  const [ready, setReady] = useState<VersionInfo | null>(null);

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

  const dismiss = () => { if (ready) seenRef.current = ready.version; setReady(null); };

  const playLatest = async () => {
    if (!ready) return;
    const first = ready.newShows[0];
    dismiss();
    window.dispatchEvent(new CustomEvent("ajn:schedule-updated", { detail: { guideId: "cable-tv" } }));
    try {
      const res = await fetch("/api/schedule?guide=cable-tv");
      const data = await res.json();
      const ch = (data.channels ?? []).find((c: any) => c.id === first.channelId);
      const p = (ch?.programs ?? []).find((x: any) => String(x.id).startsWith(first.programId));
      if (p) onPlay(p.archivePath || p.mediaUrl, p.title, p.description, p.mediaType, p.channelId, p.guideId, p.id, p.sourceId, p.assetId);
    } catch (e) { console.error("[AJN News] could not load latest news", e); }
  };

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="fixed bottom-4 right-4 z-50 max-w-sm w-[calc(100%-2rem)]">
      {ready && (
        <div className="rounded-lg border border-sky-500/40 bg-neutral-900/95 p-4 shadow-xl text-sm">
          <p className="font-semibold text-sky-300">Latest news ready — {ready.newShows.length} new show{ready.newShows.length === 1 ? "" : "s"}</p>
          {ready.fetchedAt && <p className="text-xs text-neutral-400">Fetched {new Date(ready.fetchedAt).toLocaleString()}</p>}
          <ul className="mt-2 max-h-40 overflow-y-auto space-y-1 text-neutral-200">
            {ready.newShows.slice(0, 12).map((s) => (
              <li key={s.programId} className="truncate"><span className="text-neutral-400">{s.channelName}:</span> {s.title}</li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => void playLatest()} className="rounded bg-sky-600 px-3 py-1.5 font-semibold text-white hover:bg-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-300">Play latest news</button>
            <button type="button" onClick={dismiss} className="rounded px-3 py-1.5 text-neutral-300 hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-500">Later</button>
          </div>
        </div>
      )}
    </div>
  );
}
