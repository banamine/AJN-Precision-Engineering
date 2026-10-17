// Tune-in: play what is on air "now" starting where the red line is.
// Pure helpers (no React, no network). Grid hours follow the same convention as
// EpgGuide/groupProgramsForGrid: hours-from-day-start drawn as the viewer's local hours.
import type { MediaType, Program, ScheduleChannel } from "../types";
import { localHours } from "./groupProgramsForGrid";

export interface LiveItem { program: Program; sHour: number; eHour: number }

export interface TuneResult {
  /** Media reference to play (a later segment's path for clip-segmented programmes). */
  path: string;
  /** Seconds into `path` to start at; undefined = play from the start (nothing to skip, or a live stream). */
  startAtSeconds?: number;
  /** True when the offset is exact; false when we could not map the clock to a position (plays from the start). */
  exact: boolean;
  /** Why no offset was applied, when startAtSeconds is undefined. */
  reason?: "live-stream" | "just-started" | "unknown-segment-length";
}

/** Live feeds have no fixed timeline to seek into: join them where they are. */
export function isLiveStream(program: Program): boolean {
  const meta = (program.metadata ?? {}) as Record<string, unknown>;
  return program.sourceClass === "m3u_live" || meta.isLive === true || meta.epg === "utc";
}

/** The programme whose [start, end) contains nowHour, or null (a gap / empty row). */
export function findLiveProgram(channel: ScheduleChannel, nowHour: number, nowMs?: number): LiveItem | null {
  for (const program of channel.programs) {
    const { sHour, eHour } = localHours(program, nowMs);
    if (sHour < 24 && eHour > 0 && nowHour >= sHour && nowHour < eHour) return { program, sHour, eHour };
  }
  return null;
}

function segmentSeconds(seg: any): number | null {
  const d = Number(seg?.durationSeconds);
  if (Number.isFinite(d) && d > 0) return d;
  const s = Number(seg?.start), e = Number(seg?.end);
  if (Number.isFinite(s) && Number.isFinite(e) && e > s) return e - s;
  return null;
}

export function programPath(program: Program): string {
  return String(program.archivePath || program.mediaUrl || "");
}

/** Resolve the media reference and start offset for joining `program` at `nowHour`. */
export function tuneIn(program: Program, sHour: number, eHour: number, nowHour: number): TuneResult {
  const basePath = programPath(program);
  if (isLiveStream(program)) return { path: basePath, exact: true, reason: "live-stream" };
  const total = Math.max(0, (eHour - sHour) * 3600);
  const elapsed = Math.min(total, Math.max(0, (nowHour - sHour) * 3600));
  const segs: any[] = Array.isArray(program.metadata?.segments) ? (program.metadata!.segments as any[]) : [];
  if (segs.length > 1) {
    const lengths = segs.map(segmentSeconds);
    if (lengths.some((n) => n === null)) return { path: basePath, exact: false, reason: "unknown-segment-length" };
    let cumulative = 0;
    for (let i = 0; i < segs.length; i++) {
      const len = lengths[i] as number;
      if (elapsed < cumulative + len || i === segs.length - 1) {
        const within = Math.min(len, Math.max(0, elapsed - cumulative));
        const path = String(segs[i].archivePath || segs[i].mediaUrl || basePath);
        return within > 0 ? { path, startAtSeconds: within, exact: true } : { path, exact: true, reason: "just-started" };
      }
      cumulative += len;
    }
  }
  return elapsed > 0 ? { path: basePath, startAtSeconds: elapsed, exact: true } : { path: basePath, exact: true, reason: "just-started" };
}

export function mediaTypeFor(program: Program, channel: ScheduleChannel, guideId: string): MediaType {
  return (program.mediaType || channel.mediaType || (guideId === "audio-podcasts" ? "audio" : "video")) as MediaType;
}
