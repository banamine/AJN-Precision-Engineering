import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { ScheduleChannel, Program, MediaType, PlayProgramCallback } from "./types";
import { Tv, Radio, Disc3, Sparkles } from "lucide-react";

const HOUR_WIDTH_PX = 160; // width of one hour column — drives horizontal scroll range
const TIMELINE_WIDTH_PX = HOUR_WIDTH_PX * 24;
const CHANNEL_COLUMN_WIDTH_PX = 220;
const ROW_HEIGHT_PX = 68;

function hourLabel(hour: number): string {
  const h = Math.floor(hour) % 24;
  const period = h < 12 ? "AM" : "PM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}${period}`;
}

function currentHourFraction(): number {
  const now = new Date();
  return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
}

interface EpgGuideProps {
  guideId?: string;
  /** Called with archive path, title, channel name, and mediaType when a program block is clicked. */
  onSelectProgram?: PlayProgramCallback;
}

export default function EpgGuide({ guideId = 'cable-tv', onSelectProgram }: EpgGuideProps) {
  const [nowHour, setNowHour] = useState(currentHourFraction());
  const [channels, setChannels] = useState<ScheduleChannel[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasAutoScrolled = useRef(false);

  const requestRef = useRef<AbortController | null>(null);
  const fetchSchedule = useCallback(async () => {
    // Only the latest guide request may update the grid; switching guides aborts
    // the previous one so a slow guide can't overwrite the one on screen.
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      setIsLoading(true);
      setFetchError(null);
      setChannels(null);
      const res = await fetch(`/api/schedule?guide=${encodeURIComponent(guideId)}`, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`Schedule request failed: HTTP ${res.status}`);
      }
      const data = await res.json();
      if (!Array.isArray(data.channels)) {
        throw new Error('Schedule response missing channels array');
      }
      if (controller.signal.aborted) return;
      setChannels(data.channels);
    } catch (err) {
      if (controller.signal.aborted) return;
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, [guideId]);

  useEffect(() => {
    fetchSchedule();
    return () => requestRef.current?.abort();
  }, [fetchSchedule]);

  // Live "now" line — updates every 30s, real time, not a static mockup.
  useEffect(() => {
    const interval = setInterval(() => setNowHour(currentHourFraction()), 30_000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll the timeline so "now" is visible on first render
  useEffect(() => {
    if (!scrollRef.current) return;
    const nowPx = (nowHour / 24) * TIMELINE_WIDTH_PX;
    scrollRef.current.scrollLeft = Math.max(0, nowPx - 200);
  }, [nowHour, guideId]);

  // Large guides (Live TV ~1,300 rows, documentaries) render in pages of 40
  // rows; the next page loads when the bottom sentinel scrolls into view.
  const PAGE_ROWS = 40;
  const [visibleCount, setVisibleCount] = useState(PAGE_ROWS);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setVisibleCount(PAGE_ROWS); }, [guideId]);
  const visible = useMemo(() => (channels ?? []).slice(0, visibleCount), [channels, visibleCount]);
  const hasMore = (channels?.length ?? 0) > visibleCount;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setVisibleCount((n) => n + PAGE_ROWS);
    }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, visible.length]);

  const hourMarkers = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);
  const nowLeftPx = (nowHour / 24) * TIMELINE_WIDTH_PX;

  if (fetchError) {
    return (
      <div className="w-full rounded-xl border border-red-900/50 bg-red-950/20 p-8 text-center text-sm text-red-300 space-y-3">
        <p>Error fetching guide: {fetchError}</p>
        <button
          onClick={fetchSchedule}
          className="rounded-lg border border-red-800 bg-red-900/40 px-3 py-1.5 text-xs text-red-200 hover:bg-red-900/70 cursor-pointer"
        >
          Retry Fetch
        </button>
      </div>
    );
  }

  if (isLoading || channels === null) {
    return (
      <div className="w-full rounded-xl border border-neutral-800 bg-neutral-950 p-12 text-center text-sm text-neutral-400">
        <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-sky-500 border-t-transparent mb-3" />
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="w-full overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 shadow-2xl">
      <div className="flex">
        {/* ── Sticky channel column ─────────────────────────────────────── */}
        <div
          className="flex-shrink-0 border-r border-neutral-800 bg-neutral-950 z-20"
          style={{ width: CHANNEL_COLUMN_WIDTH_PX }}
        >
          {/* Spacer matching the timeline header height */}
          <div className="h-11 border-b border-neutral-800 flex items-center px-3.5 text-xs font-semibold text-neutral-400 uppercase tracking-wider bg-neutral-900/70">
            Station / Feed
          </div>
          {visible.map((channel) => {
            const isAudio = channel.mediaType === 'audio' || guideId === 'audio-podcasts';
            return (
              <div
                key={channel.id}
                className="flex flex-col justify-center border-b border-neutral-800 px-3.5"
                style={{ height: ROW_HEIGHT_PX }}
              >
                <div className="flex items-center gap-2">
                  <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] ${
                    isAudio ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                  }`}>
                    {isAudio ? <Radio className="h-3 w-3" /> : <Tv className="h-3 w-3" />}
                  </div>
                  <span className="text-xs font-semibold text-neutral-100 truncate" title={channel.name}>
                    {channel.name}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-1 pl-7">
                  <span className="text-[10px] font-mono text-neutral-400 truncate">
                    {channel.group || (isAudio ? 'Audio Stream' : 'Video Feed')}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Scrollable timeline + program grid ───────────────────────── */}
        <div ref={scrollRef} className="overflow-x-auto relative">
          <div style={{ width: TIMELINE_WIDTH_PX }} className="relative">
            {/* Hour header */}
            <div className="sticky top-0 z-10 flex h-11 border-b border-neutral-800 bg-neutral-950/95 backdrop-blur">
              {hourMarkers.map((h) => (
                <div
                  key={h}
                  className="flex-shrink-0 border-r border-neutral-800/60 px-3 py-2.5 text-xs font-mono text-neutral-400"
                  style={{ width: HOUR_WIDTH_PX }}
                >
                  {hourLabel(h)}
                </div>
              ))}
            </div>

            {/* Channel rows with program blocks */}
            {visible.map((channel) => (
              <div
                key={channel.id}
                className="relative border-b border-neutral-800/80"
                style={{ height: ROW_HEIGHT_PX }}
              >
                {/* Hour gridlines behind the programs */}
                {hourMarkers.map((h) => (
                  <div
                    key={h}
                    className="absolute top-0 h-full border-r border-neutral-800/40 pointer-events-none"
                    style={{ left: h * HOUR_WIDTH_PX, width: HOUR_WIDTH_PX }}
                  />
                ))}

                {channel.programs.length === 0 ? (
                  <div className="absolute inset-y-0 left-0 flex items-center px-4 text-xs font-medium text-neutral-500 italic bg-neutral-900/30 w-full" style={{ width: TIMELINE_WIDTH_PX }}>
                    {channel.sourceError ? `Unavailable — ${channel.sourceError}` : channel.sourceStatus === 'restricted' ? 'Restricted by Archive' : 'No programs available'}
                  </div>
                ) : (
                  // Only today's 24h window is drawn; later slots stay in the data
                  // (auto-advance still reaches them) but add no DOM.
                  channel.programs.filter((p) => (p.startHour ?? p.startTime ?? 0) < 24).map((program, idx) => {
                    const sHour = program.startHour ?? program.startTime ?? 0;
                    const eHour = program.endHour ?? program.endTime ?? 24;
                  const isLive = nowHour >= sHour && nowHour < eHour;
                  const left = (sHour / 24) * TIMELINE_WIDTH_PX;
                  const width = ((eHour - sHour) / 24) * TIMELINE_WIDTH_PX;
                  const mediaType = program.mediaType || channel.mediaType || (guideId === 'audio-podcasts' ? 'audio' : 'video');

                  return (
                    <button
                      key={`${program.id}-${idx}`}
                      type="button"
                      id={`epg-prog-${channel.id}-${idx}`}
                      onClick={() => onSelectProgram?.(program.archivePath || program.mediaUrl, program.title, channel.name, mediaType, channel.id, program.guideId, program.id, program.sourceId ?? (program.metadata as any)?.sourceId, program.assetId ?? (program.metadata as any)?.assetId)}
                      className={`group absolute top-1.5 flex h-[calc(100%-0.75rem)] flex-col justify-center overflow-hidden rounded-lg px-3 text-left text-xs transition hover:scale-[1.005] hover:z-10 cursor-pointer ${
                        isLive
                          ? mediaType === 'audio'
                            ? "border border-amber-500/50 bg-amber-500/15 text-amber-100 shadow-md shadow-amber-500/5"
                            : "border border-sky-500/50 bg-sky-500/15 text-sky-100 shadow-md shadow-sky-500/5"
                          : "border border-neutral-800 bg-neutral-900/80 text-neutral-300 hover:border-neutral-700 hover:bg-neutral-800"
                      }`}
                      style={{ left, width: Math.max(width - 4, 20) }}
                    >
                      {isLive && (
                        <span className={`mb-0.5 inline-flex w-fit items-center gap-1 text-[10px] font-semibold uppercase tracking-wider ${
                          mediaType === 'audio' ? 'text-amber-400' : 'text-sky-400'
                        }`}>
                          <span className={`h-1.5 w-1.5 rounded-full animate-pulse ${
                            mediaType === 'audio' ? 'bg-amber-400' : 'bg-sky-400'
                          }`} />
                          On Air Now
                        </span>
                      )}
                      <span className="truncate font-semibold text-neutral-100 group-hover:text-white">
                        {program.title}
                      </span>
                      {program.description && (
                        <span className="truncate text-[10px] text-neutral-400">
                          {program.description}
                        </span>
                      )}
                    </button>
                  );
                }))}
              </div>
            ))}

            {/* Live "now" line — real current time, sweeps across in real time */}
            <div
              className="pointer-events-none absolute top-0 z-20 w-px bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]"
              style={{ left: nowLeftPx, height: 44 + visible.length * ROW_HEIGHT_PX }}
            >
              <div className="absolute -left-1 -top-1 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-red-400/40" />
            </div>
          </div>
        </div>
      </div>
      {hasMore && (
        <div ref={sentinelRef} className="border-t border-neutral-800 p-3 text-center text-xs text-neutral-500">
          Showing {visible.length} of {channels.length} channels — scroll for more
          <button type="button" onClick={() => setVisibleCount((n) => n + PAGE_ROWS)} className="ml-3 rounded border border-neutral-700 px-2 py-0.5 text-neutral-300 hover:bg-neutral-800 cursor-pointer">Load more</button>
        </div>
      )}
    </div>
  );
}

