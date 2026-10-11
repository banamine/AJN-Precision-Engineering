# Drop-in 2026-10-10: bottom-right corner reserved for the mini player
Replace src/components/NewsReadyNotice.tsx and src/components/NewsViewer.tsx.
- "Latest news ready" is now a slim pill docked under the top bar (data-testid="news-ready-dock"): Play latest news / Show list / Later. The list is collapsed by default. Never autoplays.
- The minimized news-story toast moved from bottom-right to bottom-left (sm+) / just under the top bar (phone).
Verified: tsc clean, test-news-ready-notice passes, Playwright (mocked /api/news/version, fake clock): card sits below the header at 1280 px (y=60, header bottom 53) and 390 px (y=64), list toggle shows 3 items. NOT verified: coexistence with a playing mini player on a real device.
