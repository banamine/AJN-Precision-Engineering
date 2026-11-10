import { useEffect, useMemo } from "react";
import { Play, Radio, Tv, CircleAlert } from "lucide-react";
import type { PlayProgramCallback, Program, ScheduleChannel } from "../types";
import { bufferGaugeMetadata } from "../utils/bufferGauge";
import { cleanAjnDisplayTitle } from "../utils/ajnTitleNormalizer";
import { stationLabel, type NumberedChannel } from "./channelIndex";
import { mediaTypeFor, tuneIn } from "./liveTune";
import { buildRundown, type Entry } from "./rundown";

export interface ChannelRundownProps {
  channel: ScheduleChannel | null;
  rows: readonly NumberedChannel[];
  stationOf: ReadonlyMap<string, number>;
  guideId: string;
  nowMs: number;
  nowHour: number;
  onSelectChannel: (channelId: string) => void;
  onSelectProgram?: PlayProgramCallback;
  onEnsureChannelRows?: (channelId: string, explicitRetry?: boolean) => Promise<ScheduleChannel | null>;
  channelRowStatus?: "loading" | "error";
}

export function ChannelRundown({
  channel,
  rows,
  stationOf,
  guideId,
  nowMs,
  nowHour,
  onSelectChannel,
  onSelectProgram,
  onEnsureChannelRows,
  channelRowStatus,
}: ChannelRundownProps) {
  useEffect(() => {
    if (!channel || channel.programsComplete !== false) return;
    void onEnsureChannelRows?.(channel.id);
  }, [channel, onEnsureChannelRows]);

  const rundown = useMemo(() => {
    if (!channel) return { past: [], now: null, upcoming: [] };
    return buildRundown(channel.programs, nowMs);
  }, [channel, nowMs]);

  if (!channel) {
    return (
      <div data-testid="channel-rundown-empty" className="p-10 text-center text-sm text-neutral-400">
        No channel selected.
      </div>
    );
  }

  const station = stationOf.get(channel.id) ?? 0;
  const displayChannelName = cleanAjnDisplayTitle(channel.name);
  const isAudio = channel.mediaType === "audio" || guideId === "audio-podcasts";

  const handleTuneLive = (entry: Entry) => {
    const prog = entry.program as Program;
    const tuned = tuneIn(prog, entry.startHour, entry.endHour, nowHour);
    const mediaType = mediaTypeFor(prog, channel, guideId);
    onSelectProgram?.(
      tuned.path,
      entry.title,
      displayChannelName,
      mediaType,
      channel.id,
      prog.guideId ?? guideId,
      prog.id,
      prog.sourceId ?? (typeof prog.metadata?.sourceId === "string" ? prog.metadata.sourceId : undefined),
      prog.assetId ?? (typeof prog.metadata?.assetId === "string" ? prog.metadata.assetId : undefined),
      tuned.startAtSeconds,
      bufferGaugeMetadata(prog.metadata),
    );
  };

  const handlePlayProgram = (entry: Entry) => {
    const prog = entry.program as Program;
    const mediaType = mediaTypeFor(prog, channel, guideId);
    onSelectProgram?.(
      prog.archivePath || prog.mediaUrl,
      entry.title,
      displayChannelName,
      mediaType,
      channel.id,
      prog.guideId ?? guideId,
      prog.id,
      prog.sourceId ?? (typeof prog.metadata?.sourceId === "string" ? prog.metadata.sourceId : undefined),
      prog.assetId ?? (typeof prog.metadata?.assetId === "string" ? prog.metadata.assetId : undefined),
      undefined,
      bufferGaugeMetadata(prog.metadata),
    );
  };

  const hasAnyEntries = rundown.past.length > 0 || rundown.now !== null || rundown.upcoming.length > 0;

  return (
    <div data-testid="epg-channel-rundown" data-channel-id={channel.id} className="divide-y divide-neutral-800 bg-neutral-950">
      {/* Top channel selector bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-neutral-900/50 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-neutral-300">
            CH {stationLabel(station)}
          </span>
          {isAudio ? (
            <Radio className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
          ) : (
            <Tv className="h-4 w-4 shrink-0 text-sky-400" aria-hidden="true" />
          )}
          <h3 className="truncate text-sm font-semibold text-neutral-100">{displayChannelName}</h3>
          {channel.group && (
            <span className="rounded bg-neutral-800 px-2 py-0.5 font-mono text-[10px] text-neutral-400">
              {channel.group}
            </span>
          )}
        </div>

        <label className="flex items-center gap-2 text-xs text-neutral-400">
          <span className="shrink-0 font-medium">Channel:</span>
          <select
            aria-label="Select channel for rundown"
            data-testid="rundown-channel-select"
            value={channel.id}
            onChange={(e) => onSelectChannel(e.target.value)}
            className="h-8 max-w-xs rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 text-xs text-neutral-100 focus:border-sky-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50"
          >
            {rows.map(({ channel: c, station: st }) => (
              <option key={c.id} value={c.id}>
                {stationLabel(st)} — {cleanAjnDisplayTitle(c.name)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {channelRowStatus === "loading" && (
        <div role="status" className="flex items-center gap-2 bg-sky-950/30 px-4 py-2 text-xs text-sky-200">
          <span className="h-2 w-2 animate-pulse rounded-full bg-sky-400" />
          Loading full day schedule for {displayChannelName}…
        </div>
      )}

      {channelRowStatus === "error" && (
        <div role="alert" className="flex items-center justify-between gap-2 bg-amber-950/30 px-4 py-2 text-xs text-amber-200">
          <span className="flex items-center gap-1.5">
            <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Full schedule could not be loaded.
          </span>
          <button
            type="button"
            onClick={() => {
              void onEnsureChannelRows?.(channel.id, true);
            }}
            className="rounded border border-amber-600/70 px-2 py-0.5 text-[11px] font-semibold hover:bg-amber-900/40 cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {!hasAnyEntries ? (
        <div data-testid="rundown-no-schedule" className="p-10 text-center text-sm text-neutral-400">
          No schedule data for this day
        </div>
      ) : (
        <div className="space-y-6 p-4">
          {/* Now Playing Card */}
          <section aria-label="Now Playing">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Now Playing</h4>
            </div>
            {rundown.now ? (
              <div
                data-testid="rundown-now-card"
                className={`rounded-xl border p-4 shadow-lg ${
                  isAudio
                    ? "border-amber-500/50 bg-amber-500/10 text-amber-50"
                    : "border-sky-500/50 bg-sky-500/10 text-sky-50"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span
                        className={`inline-flex items-center gap-1.5 font-semibold uppercase tracking-wider ${
                          isAudio ? "text-amber-300" : "text-sky-300"
                        }`}
                      >
                        <span
                          className={`h-2 w-2 rounded-full animate-pulse ${
                            isAudio ? "bg-amber-400" : "bg-sky-400"
                          }`}
                        />
                        On Air Now
                      </span>
                      <span className="font-mono tabular-nums text-neutral-300">
                        {rundown.now.start} – {rundown.now.end} (PT)
                      </span>
                      {rundown.now.seasonEpisode && (
                        <span
                          data-testid="rundown-season-episode"
                          className="rounded border border-neutral-700 bg-neutral-900/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-neutral-200"
                        >
                          {rundown.now.seasonEpisode}
                        </span>
                      )}
                      <span className="font-mono text-[11px] tabular-nums text-neutral-300">
                        {rundown.now.minutesRemaining} min left
                      </span>
                    </div>
                    <div className="text-base font-semibold text-white">{rundown.now.title}</div>
                    {rundown.now.program.description && (
                      <p className="line-clamp-2 text-xs text-neutral-300">{rundown.now.program.description}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    data-testid="rundown-tune-live"
                    onClick={() => {
                      if (rundown.now) handleTuneLive(rundown.now);
                    }}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-semibold transition cursor-pointer focus:outline-none focus-visible:ring-2 ${
                      isAudio
                        ? "border-amber-400/70 bg-amber-500/25 text-amber-100 hover:bg-amber-500/40 focus-visible:ring-amber-300"
                        : "border-sky-400/70 bg-sky-500/25 text-sky-100 hover:bg-sky-500/40 focus-visible:ring-sky-300"
                    }`}
                  >
                    <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                    Tune Live
                  </button>
                </div>
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-neutral-900/90">
                  <div
                    data-testid="rundown-now-progress"
                    className={`h-full transition-all ${isAudio ? "bg-amber-400" : "bg-sky-400"}`}
                    style={{ width: `${Math.round(rundown.now.progress * 100)}%` }}
                  />
                </div>
              </div>
            ) : (
              <div
                data-testid="rundown-now-empty"
                className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 text-xs text-neutral-400"
              >
                No program is scheduled in the current time slot.
              </div>
            )}
          </section>

          {/* Upcoming Section */}
          <section aria-label="Upcoming">
            <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              Upcoming ({rundown.upcoming.length})
            </h4>
            {rundown.upcoming.length === 0 ? (
              <p className="rounded-lg border border-neutral-800/80 bg-neutral-900/30 px-3.5 py-3 text-xs text-neutral-500">
                No further programs scheduled today.
              </p>
            ) : (
              <div className="divide-y divide-neutral-800/80 rounded-xl border border-neutral-800 bg-neutral-900/30">
                {rundown.upcoming.map((entry, idx) => (
                  <div
                    key={`${entry.id}-up-${idx}`}
                    data-testid="rundown-upcoming-item"
                    className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs hover:bg-neutral-900/70"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="w-40 shrink-0 font-mono text-[11px] tabular-nums text-neutral-400">
                        {entry.start} – {entry.end} (PT)
                      </span>
                      {entry.seasonEpisode && (
                        <span
                          data-testid="rundown-season-episode"
                          className="shrink-0 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-neutral-300"
                        >
                          {entry.seasonEpisode}
                        </span>
                      )}
                      <span className="truncate font-medium text-neutral-100" title={entry.title}>
                        {entry.title}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handlePlayProgram(entry)}
                      className="shrink-0 rounded border border-neutral-700 px-2.5 py-1 text-[11px] font-medium text-neutral-300 hover:bg-neutral-800 hover:text-white cursor-pointer"
                    >
                      Play
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Past Section (dimmed opacity-60) */}
          {rundown.past.length > 0 && (
            <section aria-label="Earlier Today" className="opacity-60">
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                Earlier Today ({rundown.past.length})
              </h4>
              <div className="divide-y divide-neutral-800/70 rounded-xl border border-neutral-800/80 bg-neutral-900/20">
                {rundown.past.map((entry, idx) => (
                  <div
                    key={`${entry.id}-past-${idx}`}
                    data-testid="rundown-past-item"
                    className="flex items-center justify-between gap-3 px-3.5 py-2 text-xs"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="w-40 shrink-0 font-mono text-[11px] tabular-nums text-neutral-400">
                        {entry.start} – {entry.end} (PT)
                      </span>
                      {entry.seasonEpisode && (
                        <span
                          data-testid="rundown-season-episode"
                          className="shrink-0 rounded border border-neutral-800 bg-neutral-900 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-neutral-400"
                        >
                          {entry.seasonEpisode}
                        </span>
                      )}
                      <span className="truncate text-neutral-300" title={entry.title}>
                        {entry.title}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handlePlayProgram(entry)}
                      className="shrink-0 rounded border border-neutral-800 px-2 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-800 cursor-pointer"
                    >
                      Replay
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
