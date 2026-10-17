import type { NowPlayingMedia } from "../../types";
import { useCaptionTrack } from "./useCaptionTrack";

/** Text of what is being said for TV News channel programmes. Renders nothing for anything else (no requests either).
 *  `getVideo` finds the player's <video>; it must tolerate the element being swapped between clip windows. */
export function CaptionPanel({ nowPlaying, getVideo }: { nowPlaying: NowPlayingMedia; getVideo: () => HTMLVideoElement | null }) {
  const s = useCaptionTrack(nowPlaying.archivePath, getVideo);
  if (s.phase === "off") return null;
  const shell = "rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm";
  if (s.phase === "planning") return <div data-testid="captions-planning" role="status" className={`${shell} text-neutral-400`}>Looking for captions…</div>;
  if (s.phase === "none") return <div data-testid="captions-none" role="status" className={`${shell} text-neutral-300`}>No captions for this program.</div>;
  if (s.phase === "paused") return <div data-testid="captions-paused" role="status" className={`${shell} text-amber-300`}>Captions paused: Internet Archive asked us to slow down. Resuming in about {s.retryAfter} s.</div>;
  if (s.phase === "error") return <div data-testid="captions-error" role="alert" className={`${shell} text-red-300`}>Captions unavailable ({s.reason}).</div>;
  return (
    <section data-testid="captions-panel" aria-label="Captions" className={shell}>
      <div data-testid="captions-label" className="mb-1 text-[11px] uppercase tracking-wide text-neutral-400">{s.label}</div>
      <div aria-live="off" className="max-h-28 space-y-1 overflow-y-auto text-neutral-400">
        {s.before.map((c) => <p key={`${c.start}|${c.text}`} className="leading-snug">{c.text}</p>)}
      </div>
      <p data-testid="captions-current" aria-live="polite" className="mt-1 min-h-[1.75rem] text-base font-medium leading-snug text-neutral-50">
        {s.current ? s.current.text : s.waiting ? "…" : ""}
      </p>
    </section>
  );
}
