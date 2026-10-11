# Series channels wired into Classic TV (2026-10-10)
Files (same paths): guideRegistry.ts, src/data/organizerShowsManifest.json, tools/build-organizer-manifest.py, test-classic-series-live.ts
- Taxi (114 eps), Hogan's Heroes and the other curated series (67) now appear once in Classic TV; Death Valley Days (Western) too.
- Organizer rows for The Waltons / Little House now target the series channels (classic-series-l4-bobbywalton / -bobbyprairie) instead of making a second org-* channel.
- A catalog channel with the same show name as a series channel (item-the-protectors) is folded in: episodes unioned by file path, one channel.
Verify: `npx tsc --noEmit`; `npx tsx test-series.ts test-western-death-valley.ts test-organizer-output.ts test-classic-series-live.ts` -> all pass;
`curl -s "localhost:3000/api/schedule?guide=classic-tv"` -> classic-series-taxi present once. Size: ~20.8 MB vs 24 MiB budget.
