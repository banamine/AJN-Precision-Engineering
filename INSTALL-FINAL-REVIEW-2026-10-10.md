# Final review fixes 2026-10-10 (tests only, no app code changed)
- test-media-session.mjs: click the Recently Played tile (data-testid=home-recent) instead of the first "Track a" button, which is now the On Now tile after the Home redo.
- test-cable-news-guide.ts: CNN logo expectation is the local /logos/news/cnn.png the guide now serves.
Verify: `npx tsx test-cable-news-guide.ts` and, with the app on :3000, `node test-media-session.mjs` -> no FAIL lines.
