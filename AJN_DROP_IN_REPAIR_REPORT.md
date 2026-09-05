# AJN DROP-IN REPAIR PACKAGE
## Scope
Repairs the currently demonstrated playback/telemetry defects while keeping the consumer diagnostics surface DEV-only.

## Files
- server.ts
- src/MinimalPlayer.tsx
- src/components/PlayerView.tsx
- src/telemetry.ts

## Important
This package is a surgical reference/drop-in and must be compared against the known-good server.ts and player baseline before deployment. It does not include the unrelated channel/EPG files.

## Required verification
1. `npx tsc --noEmit`
2. `npm run build`
3. `curl -i http://localhost:3000/api/health`
4. Browser playback: Fox News, CNN, MSNBC, BBC News.
5. Confirm no `MEDIA_ELEMENT_ERROR: Format error`.
6. Confirm `playback.started`, `media.error`, `playback.ended`, `playback.advance`, and `playback.loop` identity chain events in console.
7. Confirm the diagnostics identity is not rendered in the public player except under `import.meta.env.DEV`.
8. Do not publish LIVE until browser gates pass.

## Evidence rule
Build success is not runtime playback proof. Each browser gate requires real evidence.
