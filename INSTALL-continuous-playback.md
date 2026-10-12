# Continuous playback restore (2026-10-11) — drop in, same paths, on top of export _8
Files: src/components/PlayerView.tsx, src/utils/continuity.ts (new), server.ts, test-continuity.ts (new), tools/checks/continuity-check.cjs (new).
Order when an item ends or fails: 1) next in its list (channel schedule / Full Show parts / Rush / AJN Radio list), 2) another playable item from the guides, 3) AJN Full Shows audio, 4) loop that; if even that cannot start (offline) it retries every 30 s and logs playback.continuity_exhausted.
Server: /api/schedule?guide=X&channel=Y returns only that channel (22 KB instead of 23 MB); a >28 MiB body is sent gzipped instead of HTTP 406.
Verify: PowerShell:  npx tsx test-continuity.ts   (expect: continuity: all passed)
