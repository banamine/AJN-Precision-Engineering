import type { BufferGaugeSnapshot } from "./utils/bufferGauge";

export interface AjnTelemetryEvent {
  eventId: string;
  event: string;
  timestamp: string;
  guideId: string | null;
  channelId: string | null;
  sourceId: string | null;
  programId: string | null;
  titleId?: string | null;
  /** Seconds the listener waited before the event (start budget is 108 s). */
  waitedSeconds?: number;
  assetId: string | null;
  archiveIdentifier: string | null;
  mediaPath: string | null;
  proxyRequestId: string | null;
  httpStatus?: number | null;
  failureReason?: string | null;
  /** Recovery / unavailable events: why (stall-watchdog, media-error-4, offline, archive_overloaded...). */
  reason?: string | null;
  positionSeconds?: number | null;
  resolvedHost?: string | null;
  hlsType?: string | null;
  hlsDetails?: string | null;
  attempt?: number | null;
  lookupDurationMs?: number | null;
  contentType?: string | null;
  mediaErrorCode?: number | null;
  mediaErrorMessage?: string | null;
  readyState?: number | null;
  networkState?: number | null;
  nextPath?: string | null;
  bytes?: number | null;
  ms?: number | null;
  outcome?: string | null;
  unresolved?: { kind: "file" | "datetime" | "location"; field: string; reason: string } | null;
  aheadSeconds?: number;
  fillRate?: number;
  drainRate?: number;
  health?: BufferGaugeSnapshot["health"];
  underrunCount?: number;
  longestUnderrunMs?: number;
  kbpsNeeded?: number | null;
  sliceIndex?: number | null;
}

// Storm guard: a broken stream that retries must not flood the log.
// Same event + path within DEDUPE_MS is dropped; at most MAX_PER_MIN events a minute.
const DEDUPE_MS = 5_000;
const MAX_PER_MIN = 60;
const lastSeen = new Map<string, number>();
let windowStart = 0;
let windowCount = 0;
let suppressed = 0;

function allow(key: string, now: number): boolean {
  if (now - windowStart > 60_000) {
    if (suppressed) console.warn(`[AJN TELEMETRY] suppressed ${suppressed} events in the last minute`);
    windowStart = now; windowCount = 0; suppressed = 0;
  }
  const prev = lastSeen.get(key);
  if ((prev !== undefined && now - prev < DEDUPE_MS) || windowCount >= MAX_PER_MIN) { suppressed++; return false; }
  lastSeen.set(key, now);
  if (lastSeen.size > 500) lastSeen.clear();
  windowCount++;
  return true;
}

function emitTelemetry(event: Partial<AjnTelemetryEvent> & { event: string }, timestampMs = Date.now()): boolean {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.randomUUID) {
    console.warn("[AJN TELEMETRY] eventId unavailable; event not fabricated");
    return false;
  }
  const payload: AjnTelemetryEvent = {
    eventId: cryptoApi.randomUUID(),
    timestamp: new Date(timestampMs).toISOString(),
    guideId: null, channelId: null, sourceId: null, programId: null, assetId: null,
    archiveIdentifier: null, mediaPath: null, proxyRequestId: null,
    ...event,
  };
  console.log(`[AJN TELEMETRY] ${payload.event}`, payload);
  return true;
}

export function reportTelemetry(event: Partial<AjnTelemetryEvent> & { event: string }) {
  const now = Date.now();
  if (!allow(`${event.event}|${event.mediaPath ?? event.programId ?? ""}|${event.mediaErrorCode ?? ""}`, now)) return;
  emitTelemetry(event, now);
}

export interface BufferSampleReport {
  currentTime: number;
  playing: boolean;
  snapshot: BufferGaugeSnapshot;
  programId?: string | null;
  mediaPath?: string | null;
}

export interface BufferSampleLogEntry {
  sampledAtMs: number;
  timestamp: string;
  currentTime: number;
  playing: boolean;
  aheadSeconds: number;
  fillRate: number;
  fillRateRatio: number | null;
  drainRate: number;
  health: BufferGaugeSnapshot["health"];
  underrunActive: boolean;
  underrunCount: number;
  longestUnderrunMs: number;
  windowSpanMs: number;
  kbpsNeeded: number | null;
  sliceIndex: number | null;
  programId: string | null;
  mediaPath: string | null;
}

type BufferEvent = Partial<AjnTelemetryEvent> & { event: string };
type BufferEmitter = (event: BufferEvent, timestampMs: number) => boolean;

function stripMediaQuery(path: string): string {
  const query = path.search(/[?#]/);
  return query < 0 ? path : path.slice(0, query);
}

export function createBufferSampleReporter(options: {
  now?: () => number;
  emit?: BufferEmitter;
} = {}) {
  const now = options.now ?? Date.now;
  const emit = options.emit ?? emitTelemetry;
  const samples: BufferSampleLogEntry[] = [];
  const emittedAt: number[] = [];
  let previous: { health: BufferGaugeSnapshot["health"]; underrunActive: boolean } | null = null;
  let lastReportedAt: number | null = null;

  const report = (input: BufferSampleReport): boolean => {
    const time = now();
    const mediaPath = input.mediaPath ? stripMediaQuery(input.mediaPath) : null;
    const snapshot = input.snapshot;
    const entry: BufferSampleLogEntry = {
      sampledAtMs: time,
      timestamp: new Date(time).toISOString(),
      currentTime: input.currentTime,
      playing: input.playing,
      aheadSeconds: snapshot.aheadSeconds,
      fillRate: snapshot.fillRateSecondsPerSecond,
      fillRateRatio: snapshot.fillRateRatio,
      drainRate: snapshot.drainRate,
      health: snapshot.health,
      underrunActive: snapshot.underrunActive,
      underrunCount: snapshot.underrunCount,
      longestUnderrunMs: snapshot.longestUnderrunMs,
      windowSpanMs: snapshot.windowSpanMs,
      kbpsNeeded: snapshot.kbps,
      sliceIndex: snapshot.sliceIndex,
      programId: input.programId ?? null,
      mediaPath,
    };
    samples.push(entry);
    if (samples.length > 120) samples.splice(0, samples.length - 120);

    const transition = previous === null
      || previous.health !== snapshot.health
      || previous.underrunActive !== snapshot.underrunActive;
    previous = { health: snapshot.health, underrunActive: snapshot.underrunActive };
    const periodicDue = input.playing && (lastReportedAt === null || time - lastReportedAt >= 5_000);
    if (!transition && !periodicDue) return false;

    while (emittedAt.length && (time < emittedAt[0] || time - emittedAt[0] >= 60_000)) emittedAt.shift();
    if (emittedAt.length >= 30) return false;
    const emitted = emit({
      event: "playback.buffer_sample",
      programId: input.programId ?? null,
      mediaPath,
      aheadSeconds: snapshot.aheadSeconds,
      fillRate: snapshot.fillRateSecondsPerSecond,
      drainRate: snapshot.drainRate,
      health: snapshot.health,
      underrunCount: snapshot.underrunCount,
      longestUnderrunMs: snapshot.longestUnderrunMs,
      kbpsNeeded: snapshot.kbps,
      sliceIndex: snapshot.sliceIndex,
    }, time);
    if (emitted) {
      emittedAt.push(time);
      lastReportedAt = time;
    }
    return emitted;
  };

  return {
    report,
    getSamples: () => samples.map((sample) => ({ ...sample })),
  };
}

const bufferSampleReporter = createBufferSampleReporter();

/** Buffer samples use their own cadence/cap and intentionally bypass the global telemetry dedupe key. */
export function reportBufferSample(input: BufferSampleReport): boolean {
  return bufferSampleReporter.report(input);
}

/** A copy of the in-memory rolling diagnostic ring; never persisted. */
export function getBufferSamples(): BufferSampleLogEntry[] {
  return bufferSampleReporter.getSamples();
}
