# AJN General Error Repair — Drop-In

This package contains the actual source files repaired from the supplied AJN project ZIP.

Confirmed fixes:
- Archive proxy path encoding: prevents `%2520` double-encoding and normalizes legacy encoded paths.
- Archive TV segment URLs: uses the same one-time encoding path.
- Archive watchdog heartbeat: adds POST `/api/watchdog/heartbeat`.
- Proxy Inspector: 200 responses with HTML/non-media content are no longer reported as "Verified Clean".
- Playback diagnostics logging: includes titleId, routeId, and playbackId.
- Existing identity chain is preserved.
- Existing HLS/player architecture is preserved.

Drop these files over the files at the same paths in the project:

src/App.tsx
src/MinimalPlayer.tsx
src/components/ProxyTester.tsx
src/components/PlayerView.tsx
src/telemetry.ts
server.ts

Known functional issue addressed:
Classic TV / Archive Code 4 caused by already-percent-encoded Archive filenames being encoded again before being sent through `/api/archive/proxy`.

Verification required after deployment:
1. Test The Fugitive.
2. Test a normal Archive MP4.
3. Test an Archive item with `?start=0&end=300`.
4. Test Fox News and CNN.
5. Run traversal and scheme-injection tests.
6. Confirm watchdog heartbeat returns 200.
7. Confirm HTML Archive responses are not marked media-clean.
8. Confirm Dev Diagnostics retains the full identity chain.
