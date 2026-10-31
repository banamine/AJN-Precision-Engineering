import type { BufferSampleLogEntry } from "../telemetry";
import type { FetchState } from "./bufferGauge";

/**
 * Pure summary + rule checks over the REAL in-memory buffer samples (getBufferSamples()).
 * Nothing here invents data: every number is derived from a sample field, and a check
 * that cannot be decided from the samples says so instead of guessing.
 */

export type FindingLevel = "ok" | "info" | "warn" | "bad";
export interface AuditFinding { level: FindingLevel; title: string; detail: string }

export interface AuditSummary {
  programId: string | null;
  mediaPath: string | null;
  sampleCount: number;
  spanSeconds: number;
  /** Cushion stats exclude startup, i.e. samples before the first chunk arrival. */
  aheadMin: number | null;
  aheadMedian: number | null;
  aheadMax: number | null;
  underrunCount: number;
  longestUnderrunMs: number;
  chunkCount: number;
  chunkSeconds: number;
  /** Seconds of the session spent in each fetch state (sample gaps capped at 5 s). */
  fetchSeconds: Record<FetchState, number>;
  hasFetchState: boolean;
  kbpsNeeded: number | null;
  sliceIndex: number | null;
  ahead: number[];
  chunkAt: boolean[];
}

const GAP_CAP_S = 5;
const CHUNK_MIN_S = 0.05;

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Only the newest program's samples: the ring spans item changes. */
export function currentProgramSamples(samples: readonly BufferSampleLogEntry[]): BufferSampleLogEntry[] {
  if (!samples.length) return [];
  const id = samples[samples.length - 1].programId;
  let start = samples.length - 1;
  while (start > 0 && samples[start - 1].programId === id) start -= 1;
  return samples.slice(start) as BufferSampleLogEntry[];
}

export function summarizeSamples(all: readonly BufferSampleLogEntry[]): AuditSummary {
  const rows = currentProgramSamples(all);
  const fetchSeconds: Record<FetchState, number> = { loading: 0, suspended: 0, starved: 0, idle: 0, unknown: 0 };
  const ahead: number[] = [];
  const chunkAt: boolean[] = [];
  let chunkCount = 0;
  let chunkSeconds = 0;
  let hasFetchState = false;
  let prevEnd: number | null = null;

  rows.forEach((row, i) => {
    const state = row.fetchState;
    if (state) hasFetchState = true;
    if (i > 0) {
      const gap = Math.min(GAP_CAP_S, Math.max(0, (row.sampledAtMs - rows[i - 1].sampledAtMs) / 1000));
      fetchSeconds[state ?? "unknown"] += gap;
    }
    ahead.push(row.aheadSeconds);
    // Chunk arrivals: prefer the gauge's own value (new build); otherwise rebuild it from
    // currentTime + aheadSeconds = bufferedEnd on consecutive samples with no seek.
    const end = row.currentTime + row.aheadSeconds;
    let added = 0;
    if (typeof row.chunkAddedSeconds === "number") added = row.chunkAddedSeconds;
    else if (prevEnd !== null && i > 0) {
      const dt = (row.sampledAtMs - rows[i - 1].sampledAtMs) / 1000;
      const dm = row.currentTime - rows[i - 1].currentTime;
      if (dm >= 0 && Math.abs(dm - dt) <= 3) added = Math.max(0, end - prevEnd);
    }
    prevEnd = end;
    const isChunk = added > CHUNK_MIN_S;
    chunkAt.push(isChunk);
    if (isChunk) { chunkCount += 1; chunkSeconds += added; }
  });

  // Startup (before the first chunk lands) always reads ~0 s ahead: keep it out of the min/median.
  const firstChunk = chunkAt.indexOf(true);
  const steady = firstChunk >= 0 ? ahead.slice(firstChunk) : ahead;
  const last = rows[rows.length - 1];
  return {
    programId: last?.programId ?? null,
    mediaPath: last?.mediaPath ?? null,
    sampleCount: rows.length,
    spanSeconds: rows.length > 1 ? (last.sampledAtMs - rows[0].sampledAtMs) / 1000 : 0,
    aheadMin: steady.length ? Math.min(...steady) : null,
    aheadMedian: median(steady),
    aheadMax: steady.length ? Math.max(...steady) : null,
    underrunCount: last?.underrunCount ?? 0,
    longestUnderrunMs: last?.longestUnderrunMs ?? 0,
    chunkCount,
    chunkSeconds,
    fetchSeconds,
    hasFetchState,
    kbpsNeeded: last?.kbpsNeeded ?? null,
    sliceIndex: last?.sliceIndex ?? null,
    ahead,
    chunkAt,
  };
}

const EP = /s(?:eason)?[-_ ]?0*(\d{1,2})[-_ ]?e(?:pisode)?[-_ ]?0*(\d{1,3})/i;

function episodeToken(text: string): string | null {
  const m = EP.exec(text);
  return m ? `S${Number(m[1])}E${Number(m[2])}` : null;
}

/** /download/<item>/<file> -> episode tokens from the item name and the file name. */
export function pathEpisodeTokens(mediaPath: string | null): { item: string | null; file: string | null } | null {
  if (!mediaPath) return null;
  let decoded = mediaPath;
  try { decoded = decodeURIComponent(mediaPath); } catch { /* use as-is */ }
  const parts = decoded.split("/").filter(Boolean);
  if (parts[0] !== "download" || parts.length < 3) return null;
  return { item: episodeToken(parts[1]), file: episodeToken(parts[parts.length - 1]) };
}

const s1 = (n: number) => n.toFixed(1);

export function auditFindings(s: AuditSummary): AuditFinding[] {
  const out: AuditFinding[] = [];
  if (s.sampleCount === 0) {
    return [{ level: "info", title: "No playback samples yet", detail: "Play a video item for a few seconds, then reopen this section. Samples are in memory only and are lost on reload." }];
  }
  if (s.underrunCount > 0) {
    out.push({ level: "bad", title: `${s.underrunCount} underrun${s.underrunCount === 1 ? "" : "s"}`, detail: `Longest ${s1(s.longestUnderrunMs / 1000)} s. Playback stopped for data.` });
  }
  if (s.hasFetchState && s.fetchSeconds.starved > 0) {
    out.push({ level: "bad", title: "Source stopped delivering", detail: `${s1(s.fetchSeconds.starved)} s with the browser fetching but no new media while the cushion was low. Check the proxy log for that item.` });
  }
  if (s.aheadMin !== null && s.aheadMin < 10 && s.underrunCount === 0) {
    out.push({ level: "warn", title: `Cushion fell to ${s1(s.aheadMin)} s`, detail: "No underrun yet, but one slow refill at this depth would stall. Compare against the slice time in the proxy log." });
  }
  if (!s.hasFetchState) {
    out.push({ level: "info", title: "Samples have no fetchState", detail: "Captured by an older build. Fetch-state and chunk checks need the current gauge." });
  } else if (s.fetchSeconds.suspended > 0) {
    out.push({ level: "ok", title: "Browser paused fetching on purpose", detail: `${s1(s.fetchSeconds.suspended)} s with buffer held (networkState idle). That is browser behaviour, not a network fault.` });
  }
  if (s.kbpsNeeded === null) {
    out.push({ level: "info", title: "No bitrate for this program", detail: "kbpsNeeded and sliceIndex are null because the program carries no bytes/durationSeconds. That is an ingestion gap, not a player fault." });
  }
  const tok = pathEpisodeTokens(s.mediaPath);
  if (tok?.item && tok.file) {
    if (tok.item !== tok.file) {
      out.push({ level: "info", title: `Item says ${tok.item}, file says ${tok.file}`, detail: "Archive items often hold several episodes, so this can be normal. Not verified against the item's file list here." });
    } else {
      out.push({ level: "ok", title: `Item and file agree (${tok.item})`, detail: "Episode tokens in the path match." });
    }
  }
  if (!out.some((f) => f.level === "bad" || f.level === "warn")) {
    out.unshift({ level: "ok", title: "No faults in these samples", detail: `${s.sampleCount} samples over ${s1(s.spanSeconds)} s.` });
  }
  return out;
}
