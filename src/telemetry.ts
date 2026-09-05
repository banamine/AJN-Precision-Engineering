export interface AjnTelemetryEvent {
  eventId: string;
  event: string;
  timestamp: string;
  guideId: string | null;
  channelId: string | null;
  sourceId: string | null;
  programId: string | null;
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

export function reportTelemetry(event: Partial<AjnTelemetryEvent> & { event: string }) {
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
