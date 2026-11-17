# Browse panel + AudioBridge to Developer Mode - install
Copy these 6 files over your working copy (same paths), then publish:
NEW
- src/audio/diagnosticsTap.ts            (read-only hand-off of the player's analyser + buffer line)
- src/components/AudioBridgeConnected.tsx (AudioBridge panel wired to that tap)
- src/components/BrowsePanel.tsx          (tabs: Up Next | On Now)
EDITED (full files)
- src/MinimalPlayer.tsx   (drawer removed; publishes the tap; new optional `browseSlot` prop shown under the player)
- src/components/PlayerChrome.tsx (new optional `showDiagnosticsPill`; the player passes false, so the Analyzer pill is hidden)
- src/components/PlayerView.tsx   (builds Up Next from the channel schedule + recent list; passes <BrowsePanel/> as browseSlot)
- src/components/DevModeView.tsx  (uses <AudioBridgeConnected/> instead of the standalone, signal-less panel)

What changes for users
- The AudioBridge panel and "Analyzer" pill no longer show under the player. The panel now lives on NEURAL TWIN (Developer Mode) and shows the live bars/buffer line of whatever is playing.
- In its place: a Browse panel. Up Next = next programs on this channel (+ up to 4 recently played). On Now = the same live-by-category list as Home, loaded only when that tab is opened.

Test (you):
1. Play a TV channel. Under the player you see Browse > Up Next with real next programs. Tap Play on one: it starts.
2. Tap On Now, pick a category, Play a channel that is "On air". Reload: the last tab is remembered.
3. Open NEURAL TWIN while audio plays: AudioBridge bars move, the buffer line updates, "Copy buffer log" copies.
4. Stop playback / nothing playing: Neural Twin shows "No Analyser" (honest, no fake bars).
Typecheck: the 6 files produce no tsc errors (checked in a scratch copy).
Known: test-ui-phase34.mjs (Playwright) still expects the old pill/drawer; those checks are obsolete by design.
Build notes: Up Next is empty for Rush calendar items and show-queue parts (no neighbour list); the box says so.
