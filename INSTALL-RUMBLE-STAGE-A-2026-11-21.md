# Rumble wall Stage A: slot check route + #dev telemetry (2026-11-21)

Based on Builder export "ajn-precision-engineering-nov-21-2026-9-13-57-am.zip" (saved 10:38 MDT).
Drop these 12 files in at the same paths (full files, nothing else changes). No new dependencies.

New: server/rumble/slotCheck.ts, src/rumble/wallState.ts, src/rumble/slotCheck.test.ts, src/neural/rumbleTelemetry.test.ts
Changed: package.json (test:rumble now also runs the two new tests), server/rumble/routes.ts, src/rumble/types.ts,
src/rumble/logic.test.ts (route list), src/neural/topology.ts, src/neural/telemetry.ts,
src/components/RumbleNewsWall.tsx (reports mounted iframes), src/components/NeuralTwinView.tsx

## What it does
- GET /api/rumble/slots/status: read-only; re-resolves every BAKED baseline item through the existing resolver (max 3 at a time,
  cached 5 min, one shared pass for simultaneous callers, stops on rate-limited/timeout and retries no sooner than 60 s).
- #dev > Neural Twin > "Rumble wall": real baseline age, real mounted-iframe count ("0 Rumble iframes (wall not open)" when the
  wall is not mounted), and a "Check Rumble slots now" button (a real request; nothing auto-fires).
- Extra field beyond the prompt: embedIdMatches (resolver embed id vs the id the wall plays).

## Verify (you)
1. npm run test:rumble  -> expect "[rumble-slot-check] PASS" and "[rumble-telemetry] PASS" after the existing lines.
2. After publish, PowerShell:
   curl.exe -s "https://ajn-precision-engineering.ai.studio/api/rumble/slots/status"
   Expect {"ok":true,"counts":{...},"slots":[...]} ; a second call within 5 min returns the same "checkedAt".
3. Open #dev, press "Check Rumble slots now": the Rumble wall part shows the counts. Open #rumble, then #dev:
   iframe count matches the panels that were loaded.
