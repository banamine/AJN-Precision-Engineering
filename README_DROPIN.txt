AJN fixed-height queue panels drop-in (2026-11-21)
Copy these paths over the repo (same relative paths):
  src/index.css                              (appended tokens + .ajn-queue-scroll)
  src/components/FixedQueueViewport.tsx      (NEW)
  src/components/PlayerChrome.tsx            (Recently Played / Up Next use fixed viewport, cap 20)
  src/MinimalPlayer.tsx                      (audio-stage gets shrink-0)
  src/components/ScheduleDeck.tsx            (Up next list fixed height)
  src/components/RadioPresetsBar.tsx         (max-h-64 -> 5-row fixed)
  src/components/HomeView.tsx                (favorites max-h-26rem -> 5-row fixed)
