import { memo, useCallback, useEffect, useMemo } from "react";
import { Play } from "lucide-react";
import type { ScheduleChannel } from "../types";
import { cleanAjnDisplayTitle } from "../utils/ajnTitleNormalizer";
import { stationLabel, type NumberedChannel } from "./channelIndex";
import { findLiveProgram, type LiveItem } from "./liveTune";
import { buildLiveKey, currentHourFraction } from "./programHours";
import { buildRundown, nextUp } from "./rundown";
import { computeRowWindow, ROW_HEIGHT_PX } from "./virtualRows";

export interface ChannelRosterProps {
  rows: readonly NumberedChannel[];
  guideId: string;
  nowMs: number;
  nowHour: number;
  scrollTop: number;
  viewportHeight: number;
  playingChannelId?: string | null;
  onPlayLive: (channel: ScheduleChannel, item: LiveItem | null) => void;
  onOpenRundown: (channelId: string) => void;
  onEnsureChannelRows?: (channelId: string) => Promise<ScheduleChannel | null>;
}

interface RosterRowProps {
  channel: ScheduleChannel;
  station: number;
  guideId: string;
  playingChannelId: string | null;
  liveKey: string | null;
  referenceMs: number;
  onPlayLiveChannel: (channel: ScheduleChannel) => void;
  onOpenRundown: (channelId: string) => void;
}

/**
 * Memoized using plain React.memo with ordinary shallow prop comparison.
 * Replaces raw nowHour with liveKey + program-scoped referenceMs so 30s ticks
 * do not re-render unchanged rows.
 */
const RosterRow = memo(function RosterRow({
  channel,
  station,
  guideId,
  playingChannelId,
  liveKey,
  referenceMs,
  onPlayLiveChannel,
  onOpenRundown,
}: RosterRowProps) {
  const displayChannelName = cleanAjnDisplayTitle(channel.name);
  const isAudio = channel.mediaType === "audio" || guideId === "audio-podcasts";
  const isPlayingChannel = playingChannelId === channel.id;
  const { now } = useMemo(() => buildRundown(channel.programs, referenceMs), [channel.programs, referenceMs]);
  const upcomingTwo = useMemo(() => nextUp(channel.programs, referenceMs, 2), [channel.programs, referenceMs]);
  const canPlayNow = liveKey !== null || channel.hasCurrentProgram === true;

  return (
    <div
      data-testid="roster-channel-row"
      data-epg-channel-row
      data-channel-id={channel.id}
      data-live-key={liveKey ?? ""}
      style={{ height: ROW_HEIGHT_PX }}
      className={`flex items-center justify-between gap-3 border-b border-neutral-800/80 px-3.5 text-xs ${
        isPlayingChannel ? "border-l-4 border-l-emerald-400 bg-emerald-500/10" : "hover:bg-neutral-900/50"
      }`}
    >
      {/* Station number + Channel name */}
      <div className="flex min-w-0 w-56 shrink-0 items-center gap-2">
        <span
          data-testid="station-number"
          className="w-8 shrink-0 text-right font-mono text-[11px] font-semibold tabular-nums text-neutral-400"
        >
          {stationLabel(station)}
        </span>
        <button
          type="button"
          onClick={() => {
            if (canPlayNow) onPlayLiveChannel(channel);
          }}
          disabled={!canPlayNow}
          aria-label={canPlayNow ? `Play ${displayChannelName} live` : `${displayChannelName}: nothing on air`}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition ${
            canPlayNow
              ? (isAudio
                  ? "border-amber-500/50 bg-amber-500/15 text-amber-300 hover:bg-amber-500/30"
                  : "border-sky-500/50 bg-sky-500/15 text-sky-300 hover:bg-sky-500/30") + " cursor-pointer"
              : "cursor-not-allowed border-neutral-800 text-neutral-600"
          }`}
        >
          <Play className="h-3 w-3 fill-current" aria-hidden="true" />
        </button>
        <span className="truncate font-semibold text-neutral-100" title={displayChannelName}>
          {displayChannelName}
        </span>
      </div>

      {/* Now Playing + progress + minutes remaining */}
      <div className="min-w-0 flex-1 px-2">
        {now ? (
          <div className="space-y-1">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`shrink-0 rounded px-1.5 py-px text-[9px] font-bold uppercase tracking-wider ${
                  isAudio ? "bg-amber-500/20 text-amber-300" : "bg-sky-500/20 text-sky-300"
                }`}
              >
                Now
              </span>
              <span className="truncate font-medium text-neutral-100" title={now.title}>
                {now.title}
              </span>
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-neutral-400">
                {now.minutesRemaining}m left
              </span>
            </div>
            <div className="h-1 w-full max-w-xs overflow-hidden rounded-full bg-neutral-800">
              <div
                className={`h-full ${isAudio ? "bg-amber-400" : "bg-sky-400"}`}
                style={{ width: `${Math.round(now.progress * 100)}%` }}
              />
            </div>
          </div>
        ) : (
          <span className="text-[11px] italic text-neutral-500">
            {channel.programsComplete === false ? "Schedule loads on demand" : "No current program"}
          </span>
        )}
      </div>

      {/* Next two programs */}
      <div className="hidden min-w-0 flex-1 items-center gap-3 md:flex">
        {upcomingTwo.length > 0 ? (
          upcomingTwo.map((up, idx) => (
            <div key={`${up.id}-${idx}`} className="min-w-0 flex-1 truncate text-[11px] text-neutral-300">
              <span className="mr-1.5 font-mono text-[10px] tabular-nums text-neutral-500">{up.start}</span>
              <span title={up.title}>{up.title}</span>
            </div>
          ))
        ) : (
          <span className="text-[11px] text-neutral-500">—</span>
        )}
      </div>

      {/* Open rundown button */}
      <button
        type="button"
        data-testid={`open-rundown-${channel.id}`}
        onClick={() => onOpenRundown(channel.id)}
        className="shrink-0 cursor-pointer rounded-lg border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-[11px] font-semibold text-neutral-200 hover:border-sky-500/60 hover:bg-neutral-800 hover:text-white"
      >
        Open rundown
      </button>
    </div>
  );
});

export function ChannelRoster({
  rows,
  guideId,
  nowMs,
  nowHour,
  scrollTop,
  viewportHeight,
  playingChannelId = null,
  onPlayLive,
  onOpenRundown,
  onEnsureChannelRows,
}: ChannelRosterProps) {
  const heights = useMemo(() => rows.map(() => ROW_HEIGHT_PX), [rows]);
  const win = useMemo(
    () =>
      computeRowWindow({
        heights,
        scrollTop,
        viewportHeight,
        overscan: 3,
      }),
    [heights, scrollTop, viewportHeight],
  );

  const visibleSlice = useMemo(() => rows.slice(win.start, win.end), [rows, win.start, win.end]);

  useEffect(() => {
    if (guideId !== "classic-tv" || !onEnsureChannelRows) return;
    for (const { channel } of visibleSlice) {
      if (channel.programsComplete === false) {
        void onEnsureChannelRows(channel.id);
      }
    }
  }, [guideId, onEnsureChannelRows, visibleSlice]);

  const midnightMs = useMemo(() => {
    const d = new Date(nowMs);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, [nowMs]);

  const handlePlayLiveChannel = useCallback(
    (channel: ScheduleChannel) => {
      const live = findLiveProgram(channel, currentHourFraction());
      onPlayLive(channel, live);
    },
    [onPlayLive],
  );

  return (
    <div data-testid="epg-channel-roster" className="bg-neutral-950">
      <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-900/70 px-3.5 py-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
        <span className="w-56 shrink-0">Station</span>
        <span className="flex-1 px-2">Now Playing</span>
        <span className="hidden flex-1 md:inline">Next Up</span>
        <span className="w-24 text-right">Schedule</span>
      </div>
      {win.topSpacer > 0 && <div aria-hidden="true" style={{ height: win.topSpacer }} />}
      {visibleSlice.map(({ channel, station }) => {
        const live = findLiveProgram(channel, nowHour);
        const liveKey = buildLiveKey(channel.id, live);
        const referenceHour = live ? (live.sHour + live.eHour) / 2 : Math.floor(nowHour * 2) / 2;
        const referenceMs = midnightMs + Math.round(referenceHour * 3_600_000);
        return (
          <RosterRow
            key={channel.id}
            channel={channel}
            station={station}
            guideId={guideId}
            playingChannelId={playingChannelId}
            liveKey={liveKey}
            referenceMs={referenceMs}
            onPlayLiveChannel={handlePlayLiveChannel}
            onOpenRundown={onOpenRundown}
          />
        );
      })}
      {win.bottomSpacer > 0 && <div aria-hidden="true" style={{ height: win.bottomSpacer }} />}
    </div>
  );
}
