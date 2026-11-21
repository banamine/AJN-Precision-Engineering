# Labelled skip buttons (based on the 5:14 AM export, which already includes Stage 5)
Unzip over the repo root. Two files only:
- src/components/PlayerChrome.tsx: audio bar gets a "Skip" row on every width: -15s, +15s, +30s, +1m (icon + text). Each tap flashes e.g. "+30s -> 00:01:30 / 00:05:00" for 1.5 s. The old icon-only +/-10 buttons (hidden on phones) are replaced; arrow keys still skip as before. Row is hidden for live streams; buttons are disabled until the length is known.
- src/components/MiniPlayerDock.tsx: bottom dock gets "-15s" and "+30s" beside Play on any on-demand item with a length; the time row shows the same flash.
Uses the existing src/utils/podcastSkip.ts (it was in the repo but imported nowhere).
Test: play a podcast episode or a Library audio item. Press +30s twice quickly: the time jumps 60 s total and the flash shows the new time. Play a live radio station: no skip row, no dock chips.
