# Captions panel: options moved down, show art, no overlap — drop-in (2026-11-26, Phase 2)

Unzip over the repo root AFTER the fresh-first drop-in (src/utils/listenCatalog.ts is in both; this copy is the newer one). 13 files, full finished files.

What changes
1. Captions panel: Auto-sync / Captions: On / Tap: Align moved from the top to the bottom row, at the end of the skip buttons (Line, -10s, +10s, +30s). The top now holds only the art square, "Live captions" and the sync badge.
2. Show art: a small square at the top-left of the captions panel. The player also gets the show's artwork now (it was never handed to it before, which is why you saw the museum icon): from the TV guide, the Listen deck and Listen Alerts. A show with no artwork (or art that fails) shows its initials.
3. The highlighted line no longer overlaps its neighbours (context lines are one line each, the current one up to four).
Files: PodcastStage.tsx, AlertSkipBar.tsx, MinimalPlayer.tsx, ListenAlertsPanel.tsx, listenCatalog.ts, guide/scheduleCache.ts, utils/podcastArt.ts(+test), utils/alertMatch.ts, server/alertsIndex.ts, test-listen-alerts.tsx/.mjs

Check after publishing
- Play a podcast episode with a transcript: the three options are at the bottom right of the skip row; art square top-left.
- The player's thumbnail (left of the title) shows the show's picture instead of the museum icon, including when started from Listen Alerts or the Listen deck.
- Local: npx tsx src/utils/podcastArt.test.ts   (expect "# pass 2  # fail 0");  node test-listen-alerts.mjs (expect "listen alerts browser test passed")
