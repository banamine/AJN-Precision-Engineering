# AJN Telemetry Event Contract

```ts
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
  unresolved?: {
    kind: "file" | "datetime" | "location";
    field: string;
    reason: string;
  } | null;
}
```

Rules:
- IDs come from the real object graph.
- Unknown identity is null, never fabricated.
- Timestamps are real ISO timestamps.
- No Math.random() telemetry.
- No hardcoded success metrics.
