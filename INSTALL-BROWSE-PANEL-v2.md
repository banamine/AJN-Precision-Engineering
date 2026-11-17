# Browse panel + AudioBridge to Developer Mode - v2 (rebuilt on the last-known-good copy)
Replaces v1. v1 was built from the local repo and imported ./LibraryReportView, which the Builder copy does not have, and it dropped the audio-fade code. v2 is built from ajn-precision-engineering.zip (last known good), so only the lines below change.

Copy these 7 files over your working copy (same paths):
NEW
- src/audio/diagnosticsTap.ts
- src/components/AudioBridgeConnected.tsx
- src/components/BrowsePanel.tsx
EDITED (full files, small diffs against the known-good copy)
- src/MinimalPlayer.tsx            (+/- 18 lines: drawer removed, publishes analyser, `browseSlot` prop; audio-fade code untouched)
- src/components/PlayerChrome.tsx  (10 lines: optional `showDiagnosticsPill`; player passes false)
- src/components/PlayerView.tsx    (28 lines: Up Next from channel schedule + recent list -> BrowsePanel)
- src/components/DevModeView.tsx   (4 lines: AudioBridgeConnected instead of the signal-less panel)

Checked on the known-good copy: `vite build` passes (10 s); tsc shows no errors in these files.
Test: 1) play a TV channel: Browse > Up Next shows real next programs, Play works. 2) On Now: pick a category, Play an "On air" channel; tab is remembered after reload. 3) NEURAL TWIN while audio plays: bars move, buffer line updates, Copy buffer log copies. 4) Nothing playing: "No Analyser".
Known: test-ui-phase34.mjs still expects the old pill/drawer (obsolete by design).
