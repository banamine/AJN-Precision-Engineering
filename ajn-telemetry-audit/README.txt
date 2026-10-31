AJN Telemetry Audit (inside Appearance) + fetchState gauge. ONE drop-in; includes the earlier bufferGauge zip, so apply this instead of it.
Copy these over the same paths in the repo:
  src\utils\bufferGauge.ts            (changed)
  src\telemetry.ts                    (changed)
  src\MinimalPlayer.tsx               (changed)
  src\components\ajn-platform-redesign\AppearanceProvider.tsx   (changed: 2 lines)
  src\components\ajn-platform-redesign\theme.css                (appended styles only)
  src\utils\telemetryAudit.ts         (NEW)
  src\components\ajn-platform-redesign\TelemetryAudit.tsx       (NEW)
Open it: Appearance (gear) -> Telemetry Audit.
