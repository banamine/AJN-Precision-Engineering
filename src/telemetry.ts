export interface AjnTelemetryEvent {
  eventId: string;
  event: string;
  timestamp: string;
  guideId: string | null;
  channelId: string | null;
  sourceId: string | null;
  programId: string | null;
  titleId?: string | null;
  assetId: string | null;
  archiveIdentifier: string | null;
  mediaPath: string | null;
  proxyRequestId: string | null;
  httpStatus?: number | null;
  contentType?: string | null;
  mediaErrorCode?: number | null;
  mediaErrorMessage?: string | null;
  readyState?: number | null;
  networkState?: number | null;
  unresolved?: { kind: "file" | "datetime" | "location"; field: string; reason: string } | null;
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

export function reportTelemetry(event: Partial<AjnTelemetryEvent> & { event: string }) {
  if (!allow(`${event.event}|${event.mediaPath ?? event.programId ?? ""}|${event.mediaErrorCode ?? ""}`, Date.now())) return;
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.randomUUID) {
    console.warn("[AJN TELEMETRY] eventId unavailable; event not fabricated");
    return;
  }
  const payload: AjnTelemetryEvent = {
    eventId: cryptoApi.randomUUID(),
    timestamp: new Date().toISOString(),
    guideId: null, channelId: null, sourceId: null, programId: null, assetId: null,
    archiveIdentifier: null, mediaPath: null, proxyRequestId: null,
    ...event,
  };
  console.log(`[AJN TELEMETRY] ${payload.event}`, payload);
}
