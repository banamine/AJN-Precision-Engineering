# Listen polish drop-in (2026-11-27) - superset of audio-pass-all-in-one

Replace these files (full files, drop in as-is). It includes everything from audio-pass-all-in-one-dropin.zip.

New in this zip (9 files):
- src/components/SourcePrism3D.tsx: tab labels always short (Live / Music / Podcasts / Replay, full name kept as aria-label); "ARCHIVE MUSIC" -> "LIBRARY MUSIC"; new face copy; starter stations in a 3-column grid (no more truncated names), header renamed STARTER STATIONS.
- src/components/ListenBrowser.tsx: heading "LIBRARY MUSIC".
- src/components/PlayerChrome.tsx: volume slider now shows on phones (was hidden below 768 px); hidden only on iPhone/iPad where the browser ignores script volume. test id player-volume-slider.
- src/components/DeckMiniPanels.tsx, ScheduleDeck.tsx, RadioPresetsBar.tsx, MiniRotator.tsx: "Open full player >" button in the Now playing mini panel; panel height 112 -> 132 px.
- src/utils/serviceStatus.ts, src/components/StatusIndicators.tsx: News stale badge count is spoken as "12 channels behind" (was "12 new"); tooltip explains the number.

NOT in this zip: Charlie Kirk removal (see chat).
Verify after publish: Listen page at phone width: tabs read Live/Music/Podcasts/Replay; Now playing mini panel has "Open full player"; full player shows the volume slider; badge tooltip says channels behind.
