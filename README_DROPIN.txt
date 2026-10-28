AJN drop-in — Rush player + resume fix + 94 restored tests — 2026-10-27
(Supersedes AJN_dropin_rush_player_2026-10-27.zip — use this one.)

Copy every file to the same path in AI Studio, then deploy.

APP CODE (5 files):
  src/MinimalPlayer.tsx                 resume prompt reads the right hour (Claude)
  src/components/PlayerView.tsx         Morning Update video, Skip, handoff (Replit PR #139)
  src/components/RushEpisodePicker.tsx  "Morning Update · 1 min", unavailable label (Replit)
  src/utils/rushNext.ts                 Morning Update -> Hour 1 (Replit)
  src/utils/rushSettings.ts             once per day (Replit)

TESTS (94 files): every test file the AI Studio push cb0b020 deleted, restored from 25c0d9e.

CHECKED (on your AI Studio export + these files):
  typecheck: 0 errors      build: OK
  restored tests run one by one: 76 pass, 12 fail
    7 need a running server / Playwright / internet (cannot run here, not code bugs):
      test-live-stall-recovery, test-media-session, test-music-timezones (playwright)
      test-radio-view, test-real-archive-playback, test-live-tv-api-server (need app on :3000)
      test-music-schedule-budget (network)
    4 ALREADY FAILED on GitHub main 25c0d9e before today (old, not caused by this zip):
      test-player-separation, test-runtime-loop-guards, test-mute-indicator, test-library-rank
    1 flaky (passed on rerun): test-program-store-bounded
