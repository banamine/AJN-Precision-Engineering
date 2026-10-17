import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Clock, Headphones, ListChecks, Play, RefreshCw, Tv } from "lucide-react";
import type { Destination, Guide, MediaType, PlayProgramCallback, ScheduleChannel } from "../types";
import { getCachedSchedule, isStale, setCachedSchedule } from "../guide/scheduleCache";
import { buildToday, formatHour, thumbnailOf, type TodayChannel, type TodayEntry } from "../guide/todayList";
import { tuneIn, mediaTypeFor } from "../guide/liveTune";
import { ChannelLogo } from "./ChannelLogo";

const AJN_RESOURCE_GUIDE_ID = "ajn-archive-special-feeds";
const FALLBACK_GUIDES: Guide[] = [
  { id: "cable-tv", name: "Cable TV", type: "video", enabled: true },
  { id: "audio-podcasts", name: "Audio & Podcasts", type: "audio", enabled: true },
];
const SLOW_LOAD_MS = 15_000;
const UPCOMING_PREVIEW = 6;

interface TodayViewProps {
  onSelectProgram: PlayProgramCallback;
  onNavigate?: (dest: Destination) => void;
}

function nowHourFraction(): number {
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}

const KIND_LABEL = { live: "LIVE", replay: "REPLAY", audio: "AUDIO" } as const;
const KIND_STYLE = {
  live: "bg-red-600 text-white",
  replay: "bg-neutral-700 text-neutral-200",
  audio: "bg-amber-500/20 text-amber-300",
} as const;

function KindBadge({ kind }: { kind: TodayEntry["kind"] }) {
  return <span data-testid={`kind-${kind}`} className={`rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${KIND_STYLE[kind]}`}>{KIND_LABEL[kind]}</span>;
}

function Thumb({ entry, channel, className }: { entry: TodayEntry; channel: ScheduleChannel; className: string }) {
  const url = thumbnailOf(entry.program);
  const [failed, setFailed] = useState(false);
  const isAudio = (entry.program.mediaType || channel.mediaType) === "audio";
  if (url && !failed) {
    return <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} className={`${className} object-cover`} />;
  }
  return (
    <div aria-hidden="true" className={`${className} flex items-center justify-center bg-neutral-800 text-neutral-500`}>
      {isAudio ? <Headphones className="h-5 w-5" /> : <Tv className="h-5 w-5" />}
    </div>
  );
}

export function TodayView({ onSelectProgram, onNavigate }: TodayViewProps) {
  const [guides, setGuides] = useState<Guide[]>(FALLBACK_GUIDES);
  const [guideId, setGuideId] = useState("cable-tv");
  const [channels, setChannels] = useState<ScheduleChannel[] | null>(() => getCachedSchedule("cable-tv")?.channels ?? null);
  const [loading, setLoading] = useState(() => !getCachedSchedule("cable-tv"));
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowHour, setNowHour] = useState(nowHourFraction());
  const [showEarlier, setShowEarlier] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const reqRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const c = new AbortController();
    fetch("/api/guides", { signal: c.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || !Array.isArray(d.guides)) return;
        const list = (d.guides as Guide[]).filter((g) => g.id !== AJN_RESOURCE_GUIDE_ID && g.enabled !== false);
        if (list.length) setGuides(list);
      })
      .catch(() => { /* keep the built-in list; the schedule request reports its own errors */ });
    return () => c.abort();
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setNowHour(nowHourFraction()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const load = useCallback(async (id: string, force = false) => {
    reqRef.current?.abort();
    const c = new AbortController();
    reqRef.current = c;
    const cached = getCachedSchedule(id);
    if (cached) { setChannels(cached.channels); setLoading(false); setError(null); } else { setChannels(null); setLoading(true); setError(null); }
    if (cached && !force && !isStale(cached)) return;
    setSlow(false);
    const slowTimer = window.setTimeout(() => { if (!c.signal.aborted) setSlow(true); }, SLOW_LOAD_MS);
    try {
      const res = await fetch(`/api/schedule?guide=${encodeURIComponent(id)}`, { signal: c.signal });
      if (!res.ok) throw new Error(`Schedule request failed: HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.channels) || data.channels.length === 0) throw new Error("This guide returned no channels");
      if (c.signal.aborted) return;
      setCachedSchedule(id, data.channels);
      setChannels(data.channels);
      setError(null);
    } catch (e) {
      if (c.signal.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      window.clearTimeout(slowTimer);
      if (!c.signal.aborted) { setLoading(false); setSlow(false); }
    }
  }, []);

  useEffect(() => { void load(guideId); return () => reqRef.current?.abort(); }, [guideId, load]);

  const today = useMemo<TodayChannel[]>(() => (channels ? buildToday(channels, nowHour) : []), [channels, nowHour]);
  const onNow = today.filter((t) => t.now);
  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  const play = (tc: TodayChannel, entry: TodayEntry, joinNow: boolean) => {
    const p = entry.program;
    const media = mediaTypeFor(p, tc.channel, guideId) as MediaType;
    const sourceId = p.sourceId ?? (p.metadata?.sourceId as string | undefined);
    const assetId = p.assetId ?? (p.metadata?.assetId as string | undefined);
    if (joinNow) {
      const t = tuneIn(p, entry.sHour, entry.eHour, nowHour);
      onSelectProgram(t.path, p.title, tc.channel.name, media, tc.channel.id, p.guideId, p.id, sourceId, assetId, t.startAtSeconds);
    } else {
      onSelectProgram(p.archivePath || p.mediaUrl, p.title, tc.channel.name, media, tc.channel.id, p.guideId, p.id, sourceId, assetId);
    }
  };

  const jump = (id: string) => document.getElementById(`today-ch-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const renderRow = (tc: TodayChannel, entry: TodayEntry, isNow: boolean, key: string) => {
    const playable = Boolean(entry.program.archivePath || entry.program.mediaUrl);
    return (
      <li key={key}>
        <button type="button" disabled={!playable} onClick={() => play(tc, entry, isNow)} data-testid="today-row"
          aria-label={`${isNow ? "Play now" : "Play"} ${entry.program.title}, ${tc.channel.name}, ${formatHour(entry.sHour)}`}
          className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-neutral-800/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:opacity-50">
          <span className="w-[4.6rem] shrink-0 font-mono text-[11px] tabular-nums text-neutral-400">{formatHour(entry.sHour)}</span>
          <Thumb entry={entry} channel={tc.channel} className="h-9 w-14 shrink-0 rounded" />
          <span className="min-w-0 flex-1 truncate text-sm text-neutral-100">{entry.program.title}</span>
          <KindBadge kind={entry.kind} />
        </button>
      </li>
    );
  };

  return (
    <div className="space-y-6 pb-16" data-testid="today-view">
      <header className="flex flex-col gap-3 border-b border-neutral-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-sky-500/25 bg-sky-500/10 text-sky-400"><ListChecks className="h-4 w-4" /></div>
            <h1 className="text-xl font-semibold tracking-tight text-neutral-50 sm:text-2xl">Today's Programs</h1>
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-neutral-400"><CalendarDays className="h-3.5 w-3.5" />{dateLabel} · your local 24-hour day, 12:00 AM to 11:59 PM</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void load(guideId, true)} className="flex items-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"><RefreshCw className="h-3.5 w-3.5" />Refresh</button>
          <button type="button" onClick={() => onNavigate?.("tv-guide")} className="flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"><Clock className="h-3.5 w-3.5" />Full time grid</button>
        </div>
      </header>

      <nav aria-label="Guides" className="flex flex-wrap gap-1.5">
        {guides.map((g) => (
          <button key={g.id} type="button" onClick={() => { setGuideId(g.id); setExpanded({}); }} aria-pressed={g.id === guideId} data-testid={`today-guide-${g.id}`}
            className={`rounded-full border px-3.5 py-2 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${g.id === guideId ? "border-sky-500 bg-sky-500 text-white" : "border-neutral-700 text-neutral-300 hover:bg-neutral-800"}`}>
            {g.name}
          </button>
        ))}
      </nav>

      {loading && !channels && (
        <div role="status" className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6 text-sm text-neutral-300">
          {slow ? "Still loading — this guide is slow to respond." : "Loading today's programmes…"}
          {slow && <button type="button" onClick={() => void load(guideId, true)} className="ml-3 rounded bg-white px-3 py-1 text-xs font-semibold text-black">Retry</button>}
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-xl border border-red-500/40 bg-red-950/30 p-4 text-sm text-red-200">
          Could not load this guide: {error}
          <button type="button" onClick={() => void load(guideId, true)} className="ml-3 rounded bg-white px-3 py-1 text-xs font-semibold text-black">Retry</button>
        </div>
      )}

      {channels && (
        <>
          <section aria-labelledby="today-now">
            <h2 id="today-now" className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-300">On now · {formatHour(nowHour)}</h2>
            {onNow.length === 0 ? (
              <p className="text-sm text-neutral-400">Nothing is scheduled at this moment in this guide. Pick something from the lists below.</p>
            ) : (
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {onNow.map((tc) => {
                  const e = tc.now!;
                  const pct = Math.min(100, Math.max(0, ((nowHour - e.sHour) / (e.eHour - e.sHour)) * 100));
                  return (
                    <li key={tc.channel.id} data-testid="today-now-card">
                      <button type="button" onClick={() => play(tc, e, true)} aria-label={`Play now: ${e.program.title}, ${tc.channel.name}`}
                        className="group flex w-full gap-3 rounded-xl border border-sky-500/30 bg-sky-500/5 p-3 text-left hover:bg-sky-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
                        <Thumb entry={e} channel={tc.channel} className="h-16 w-24 shrink-0 rounded-lg" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 text-[11px] text-sky-300"><span className="truncate font-semibold">{tc.channel.name}</span><KindBadge kind={e.kind} /></span>
                          <span className="mt-0.5 block truncate text-sm font-semibold text-neutral-50">{e.program.title}</span>
                          <span className="block font-mono text-[11px] text-neutral-400">{formatHour(e.sHour)} – {formatHour(e.eHour)}</span>
                          <span className="mt-1.5 block h-1 overflow-hidden rounded bg-neutral-700"><span className="block h-full bg-sky-400" style={{ width: `${pct}%` }} /></span>
                        </span>
                        <Play className="h-5 w-5 shrink-0 self-center text-sky-300 group-hover:text-white" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <nav aria-label="Jump to channel" className="flex flex-wrap gap-1.5">
              {today.map((tc) => (
                <button key={tc.channel.id} type="button" onClick={() => jump(tc.channel.id)} className="flex items-center gap-1.5 rounded-full border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
                  <ChannelLogo logo={tc.channel.logo} name={tc.channel.name} fallback={<span className="h-4 w-4 rounded bg-neutral-700" aria-hidden="true" />} />
                  <span>{tc.channel.name}</span>
                </button>
              ))}
            </nav>
            <label className="flex items-center gap-2 text-xs text-neutral-300">
              <input type="checkbox" checked={showEarlier} onChange={(e) => setShowEarlier(e.target.checked)} className="h-4 w-4 accent-sky-500" />Show earlier today
            </label>
          </div>

          <div className="space-y-4">
            {today.map((tc) => {
              const open = expanded[tc.channel.id] === true;
              const upcoming = open ? tc.upcoming : tc.upcoming.slice(0, UPCOMING_PREVIEW);
              const total = tc.upcoming.length + tc.earlier.length + (tc.now ? 1 : 0);
              return (
                <section key={tc.channel.id} id={`today-ch-${tc.channel.id}`} data-testid="today-channel" aria-label={tc.channel.name} className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
                  <header className="mb-1 flex items-center gap-2.5 px-1">
                    <ChannelLogo logo={tc.channel.logo} name={tc.channel.name} fallback={<div className="flex h-6 w-6 items-center justify-center rounded bg-neutral-800 text-neutral-400" aria-hidden="true">{tc.channel.mediaType === "audio" ? <Headphones className="h-3.5 w-3.5" /> : <Tv className="h-3.5 w-3.5" />}</div>} />
                    <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-50">{tc.channel.name}</h3>
                    <span className="text-[11px] text-neutral-500">{total} today</span>
                  </header>
                  {total === 0 ? (
                    <p className="px-2 py-2 text-xs text-neutral-400">{tc.channel.sourceError ? `No programmes: ${tc.channel.sourceError}` : tc.channel.sourceStatus && tc.channel.sourceStatus !== "ok" ? `No programmes (source ${tc.channel.sourceStatus}).` : "No programmes scheduled today."}</p>
                  ) : (
                    <ul>
                      {showEarlier && tc.earlier.map((e) => renderRow(tc, e, false, `${e.program.id}-e`))}
                      {tc.now && renderRow(tc, tc.now, true, `${tc.now.program.id}-n`)}
                      {upcoming.map((e) => renderRow(tc, e, false, `${e.program.id}-u`))}
                    </ul>
                  )}
                  {tc.upcoming.length > UPCOMING_PREVIEW && (
                    <button type="button" onClick={() => setExpanded((x) => ({ ...x, [tc.channel.id]: !open }))} className="mt-1 px-2 py-1 text-xs font-semibold text-sky-300 hover:text-sky-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
                      {open ? "Show fewer" : `Show all ${tc.upcoming.length} remaining`}
                    </button>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
