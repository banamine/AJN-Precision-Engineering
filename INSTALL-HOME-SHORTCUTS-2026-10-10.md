# Home shortcuts: latest Alex Jones + War Room full show (2026-10-10)
Replace files at the same paths, then republish:
- src/utils/latestFullShows.ts (new)
- src/hooks/useLatestFullShows.ts (new)
- src/components/HomeView.tsx (changed)
- test-latest-full-shows.ts, test-cloud-sync.ts (tests; cloud-sync one is a tsc-clean fix)

Behaviour
- Two orange-red buttons on the Home hero: "ALEX JONES · FULL SHOW" and "WAR ROOM · FULL SHOW" with the air date.
- Each plays the newest whole-show audio file from the AJN feeds (/api/ajn/resources/Alex and /WarRoom). Saturdays are labelled SPECIAL.
- Links refresh every 30 min and on page load, so a new day's files replace the old ones with no code change.
- If the feed fails the buttons are replaced by an explicit "unavailable" message (no fake fallback).
- Independent of the other zips. Needs no server change.
Verify: Home shows both buttons with the newest date; tap one -> Player opens and the proxied .mp3 loads.
