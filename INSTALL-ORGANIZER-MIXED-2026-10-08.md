# Organizer Output pass 2: Mixed (100) + gzip for /api/schedule (2026-10-08)
Copy over the repo (same paths):
- src/data/organizerShowsManifest.json   (REPLACES the previous one: Classic TV + TV + Mixed, de-duplicated)
- server.ts                               (ONE change in /api/schedule: gzip when the browser accepts it; 15 MB -> 1.5 MB)
- tools/build-organizer-manifest.py, reports/organizer-routing.json
guideRegistry.ts and test-organizer-output.ts are unchanged from the previous zip (no need to re-copy).
Verify: NODE_ENV=test npx tsx test-organizer-output.ts -> PASS organizer-output: 6770 rows, 90 channels, classic-tv now 135 channels
Live:   curl -s -H "Accept-Encoding: gzip" -o /dev/null -w "%{size_download}\n" "$HOST/api/schedule?guide=classic-tv"  -> ~1.5 MB (was ~5.8 MB uncompressed before, 15 MB uncompressed now)
