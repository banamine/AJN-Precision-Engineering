# Organizer Output -> Classic EPG TV Guide (2026-10-08)
Copy these files over the repo (same paths). guideRegistry.ts is CUMULATIVE (includes Old British TV + show sources) and supersedes the one in the Old British zip.
- guideRegistry.ts  (applyOrganizerOutput, called after the archive-item layout)
- src/data/organizerShowsManifest.json
- tools/build-organizer-manifest.py, test-organizer-output.ts, reports/organizer-routing.json
Verify: `NODE_ENV=test npx tsx test-organizer-output.ts`  -> PASS organizer-output: 1757 rows, 42 channels, classic-tv now 93 channels
Only Classic TV + TV folders are wired. Movies / Mixed / Music are report-only.
