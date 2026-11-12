# Drop-in 2 (2026-11-12): completes the TV story ledger on your Builder export

Apply ON TOP of drop-in 1 (already in your export). Copy each file to the same repo path.
- server.ts            full file = your export's server.ts + 2 lines: the import and `registerTvStoriesRoute(app);` after `registerNowPlayingRoute(app);` (before the `/api` 404 catch-all).
- package.json         full file = your export's + `"test:tv-stories"` script.
- server/tvHeadlines.ts, server/captions/{captionPool,excerptScore,storyGrouping,programFilter}.ts   were missing from Builder; the story files import them.

Verify: npm run test:tv-stories -> "10 tests passed"; then open /api/tv-stories on the preview: JSON with networks[] and stories [] at first (window.building true); after 10-20 min stories fill and Face 6 shows them.
