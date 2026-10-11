# Today list + Replay labels + honest player (2026-10-10)
Same-path file replacement in Google Builder. Requires the earlier Guide-logos zip (EpgGuide.tsx here includes the logo change).

NEW: src/components/TodayView.tsx, src/guide/todayList.ts (Today's Programs page, route #today)
CHANGED: src/types.ts, src/nav/lastView.ts, src/App.tsx, src/components/Navigation.tsx, src/components/TvGuideView.tsx, src/EpgGuide.tsx, src/components/PlayerChrome.tsx, src/components/PlayerView.tsx, src/MinimalPlayer.tsx
TESTS: test-today-view.tsx, test-player-honesty.tsx

What changes
1. Player says LIVE only for a real live stream. Unknown duration (loading/stalled) shows "Loading…", seek stays disabled.
2. Guide on-air tiles that are archive recordings get a REPLAY tag. Banner "Live Grid Active" -> "Schedule Running".
3. Stalled/failed playback shows Retry and Back to Guide.
4. Empty Player: "Open Guide" -> new Today's Programs page (+ "Full time grid").
5. Today's Programs: on-now cards with progress, per-channel rundown for your local 24-hour day, thumbnails when the schedule has them, LIVE/REPLAY/AUDIO badges, guide chips, jump-to-channel chips, "Show earlier today", Refresh, honest loading/slow/error states. Also reachable from the Guide header ("Today's list").
Search label unchanged.

Verify (optional): npx tsx test-today-view.tsx && npx tsx test-player-honesty.tsx
Check by hand: Player tab with nothing playing -> Open Guide; open a file and watch the badge read "Loading…" not LIVE; Guide header shows "Today's list".
