# Lists expansion + schedule-size guard (apply over ajn-precision-engineering_5)
Cumulative: includes the earlier 2026-10-10 zips (series channels, final test fixes, live soak, stall diagnostics, offline recovery, daily frames), so apply this ONE zip over `_5`.

## New in this zip
- `tools/build-infobattalion-lists.py` (+ `reports/infobattalion-lists.json`): adds NEW members of @infobattalion lists to their contracts. Skips anything already referenced in the app, dark/private items, Russian-language titles, whole-word "SEX" rows (owner rule 2026-10-04), TV-episode titles inside movie lists.
- `src/data/extraChannelsManifest.json`: classic-tv `tvx-*` (45 shows + "Specials & Singles"), movies `mx-movies-classics-list`, `mx-filmography` (opensource_movies query), `mx-atlas-taggart` (@atlas_taggart826 page), cable-tv `ajn-new-world-tyranny`.
- `src/data/documentariesManifest.json`: +46 documentary groups.
- `src/data/archiveAudioChannels.json`: +62 audio entries (Old-Time Radio 11, New World Tyranny 4, Music 47); `maxSlots` (default 120, Music 48) caps programs per day.
- `guideRegistry.ts`: classic-tv appends the `tvx-*` extras (daily rotation); audio honours `maxSlots`. `server/audioChannels.ts`: `maxSlots?`, `verifiedAt?`.
- `server.ts`: /api/schedule answers HTTP 406 with a plain message instead of Cloud Run's opaque 5xx when the body is > 28 MiB and the client did not send Accept-Encoding: gzip.
- `test-infobattalion-lists.ts`: ids unique, per-guide payload budgets, Taxi still present, new channels non-empty.
- `tools/live-soak/*`: waits up to 96 s for the guide; slice-speed.ps1 fetches the schedule with curl.exe --compressed.

## Verify
1. `npx tsc --noEmit` (0) and `npx tsx test-infobattalion-lists.ts` -> `infobattalion lists OK`.
2. Live, after deploy: `curl.exe -s --compressed -o NUL -w "%{http_code} %{size_download}\n" "$APP/api/schedule?guide=classic-tv"` -> `200`, a few MB.
3. Without gzip (PowerShell's default): `curl.exe -s -w "%{http_code}\n" -o NUL "$APP/api/schedule?guide=classic-tv"` -> `406` with a message (was a bare 500).
4. Guides show: Movies (3 new channels), Cable TV "NEW WORLD TYRANNY", Science Documentaries (46 new groups), Classic TV (`tvx-*`), Audio (Old-Time Radio / Music / New World Tyranny rows; they say "loading" for the first minute after a deploy).
