---
name: ajn-telemetry-reading
description: Read and interpret AJN telemetry — Health panel, status indicators, alerts, DiagnosticsHUD, proxy diagnostics, /api/archive/status and browser network/console — and separate real signals from false positives.
---

# Reading AJN telemetry

## Sources, in trust order
1. Network panel / curl responses (status, `Content-Range`, timing).
2. Server logs (Cloud Run / Replit console).
3. `/api/archive/status` and other `/api/*` health endpoints.
4. In-app Health panel, StatusIndicatorBar, alerts, DiagnosticsHUD.
In-app indicators are only as good as their source — confirm a red/green against 1–3.

## Fake-telemetry red flags (report immediately)
- Values that change without network activity, `Math.random()`, constant round numbers, FPS/bitrate shown for a paused or embed player.
- "OK/green" when the media request failed.
- `null`/`undefined` error codes shown to the user; "unknown" should say what is unknown.

## Interpreting common signals
| Signal | Meaning | Next |
|---|---|---|
| media request 206, video silent/black | decode/codec or CORS on audio graph | check codec (h.264?), crossorigin |
| 502/504 on proxy | upstream timeout or > 32 MiB response | check Range header, slice size |
| many Archive items fail at once | outage | `ajn-archive-outage` |
| alert fires on resume/seek | likely false positive (stall during seek) | check `waiting`→`playing` within threshold |
| guide empty for news channels | feed window/timezone | `ajn-epg-organization` |

## Commands
```
curl -s $BASE/api/archive/status | jq
curl -s -o /dev/null -D - -H "Range: bytes=0-1023" "$BASE/api/archive/proxy?url=<enc>"   # expect 206 + Content-Range
```

## Report
For each signal: what it showed, what ground truth showed, verdict (real / false positive / unverified).
