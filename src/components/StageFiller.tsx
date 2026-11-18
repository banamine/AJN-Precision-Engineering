import { useEffect, useState } from "react";
import { useDigest } from "../hooks/useDigest";
import { pickHeadlines } from "./stageFillerLogic";

interface Props { programId?: string; title: string; subtitle?: string; artUrl?: string | null; duration?: string }

const WIDTH = "w-[clamp(8rem,calc(50.6vw-225px),19rem)]";

/** Real content for the audio stage when the signal meter cannot read this source: what is playing, plus today's headlines. Wide windows only. */
export default function StageFiller({ programId, title, subtitle, artUrl, duration }: Props) {
  const view = useDigest();
  const headlines = pickHeadlines(view, 4);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    setNote(null);
    if (!programId || !programId.startsWith("pod-")) return;
    const ctl = new AbortController();
    fetch(`/api/podcast/episode-note?id=${encodeURIComponent(programId)}`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { note?: unknown } | null) => { if (typeof j?.note === "string") setNote(j.note); })
      .catch(() => { /* no note: the card simply omits it */ });
    return () => ctl.abort();
  }, [programId]);
  return (
    <>
    <div data-testid="stage-filler-compact" className="pointer-events-none absolute inset-x-2 bottom-2 z-[4] md:hidden">
      <div className="pointer-events-auto rounded-lg border border-white/10 bg-black/60 px-2.5 py-2 backdrop-blur-sm">
        <p className="truncate text-[11px] font-semibold text-white">{title}</p>
        {subtitle && <p className="truncate text-[10px] text-slate-300">{subtitle}</p>}
        {headlines[0] && (
          <a href={headlines[0].url} target="_blank" rel="noopener noreferrer" className="mt-1 block truncate text-[10px] text-cyan-200 hover:underline focus:underline">Headline: {headlines[0].title}</a>
        )}
      </div>
    </div>
    <div data-testid="stage-filler" className="pointer-events-none absolute inset-0 z-[4] hidden md:block">
      <section aria-label="Now playing" className={`pointer-events-auto absolute left-[2%] top-1/2 max-h-[84%] -translate-y-1/2 overflow-hidden rounded-xl border border-white/10 bg-black/55 p-3 backdrop-blur-sm ${WIDTH}`}>
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-200">Now playing</p>
        {artUrl && <img src={artUrl} alt="" aria-hidden="true" className="mt-2 aspect-square w-full rounded-lg object-cover" />}
        <h2 className="mt-2 line-clamp-3 text-sm font-semibold leading-snug text-white">{title}</h2>
        {subtitle && <p className="mt-1 line-clamp-2 text-xs text-slate-300">{subtitle}</p>}
        {note && <p data-testid="episode-note" className="mt-2 line-clamp-5 text-[11px] leading-snug text-slate-200">{note}</p>}
        {duration && <p className="mt-1 text-[11px] text-slate-400">{duration}</p>}
        <p className="mt-2 text-[10px] text-slate-400">No level meter for this source. Sound is unaffected.</p>
      </section>
      {headlines.length > 0 && (
        <section aria-label="Headlines" className={`pointer-events-auto absolute right-[2%] top-1/2 max-h-[84%] -translate-y-1/2 overflow-hidden rounded-xl border border-white/10 bg-black/55 p-3 backdrop-blur-sm ${WIDTH}`}>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-200">Headlines</p>
          <ul className="mt-2 space-y-2">
            {headlines.map((h) => (
              <li key={h.id}>
                <a href={h.url} target="_blank" rel="noopener noreferrer" className="line-clamp-3 text-xs font-medium leading-snug text-white hover:underline focus:underline">{h.title}</a>
                <span className="text-[10px] text-slate-400">{h.source}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
    </>
  );
}
