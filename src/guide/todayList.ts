// "Today" list: pure helpers that turn a guide's schedule into a 24-hour, per-channel rundown.
// No React, no network. Hours follow the same convention as the Guide grid (viewer's local day, 0-24).
import type { Program, ScheduleChannel } from "../types";
import { localHours } from "./groupProgramsForGrid";
import { isLiveStream } from "./liveTune";

/** live = a real live stream; replay = an archive recording scheduled into the slot; audio = radio/podcast/music. */
export type ProgramKind = "live" | "replay" | "audio";

export interface TodayEntry {
  program: Program;
  sHour: number;
  eHour: number;
  kind: ProgramKind;
}

export interface TodayChannel {
  channel: ScheduleChannel;
  now: TodayEntry | null;
  upcoming: TodayEntry[];
  earlier: TodayEntry[];
}

export function kindOf(program: Program, channel: ScheduleChannel): ProgramKind {
  const media = program.mediaType || channel.mediaType;
  if (isLiveStream(program)) return "live";
  return media === "audio" ? "audio" : "replay";
}

export function formatHour(hour: number): string {
  const total = Math.round(Math.min(24, Math.max(0, hour)) * 60);
  const h24 = Math.floor(total / 60) % 24;
  const m = total % 60;
  const period = h24 < 12 ? "AM" : "PM";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(m).padStart(2, "0")} ${period}`;
}

export function thumbnailOf(program: Program): string | undefined {
  const t = program.metadata?.thumbnailUrl;
  return typeof t === "string" && (t.startsWith("/") || t.startsWith("https://")) ? t : undefined;
}

/** Programmes inside the viewer's 24-hour day, per channel, split into earlier / now / upcoming. */
export function buildToday(channels: ScheduleChannel[], nowHour: number, nowMs: number = Date.now()): TodayChannel[] {
  return channels.map((channel) => {
    const entries: TodayEntry[] = [];
    for (const program of channel.programs ?? []) {
      const { sHour, eHour } = localHours(program, nowMs);
      if (!(eHour > sHour) || sHour >= 24 || eHour <= 0) continue; // outside today or empty
      entries.push({ program, sHour: Math.max(0, sHour), eHour: Math.min(24, eHour), kind: kindOf(program, channel) });
    }
    entries.sort((a, b) => a.sHour - b.sHour || a.eHour - b.eHour);
    const now = entries.find((e) => nowHour >= e.sHour && nowHour < e.eHour) ?? null;
    return {
      channel,
      now,
      upcoming: entries.filter((e) => e.sHour >= nowHour && e !== now),
      earlier: entries.filter((e) => e.eHour <= nowHour && e !== now),
    };
  });
}
