AJN Uniform Shell - Stage 1 drop-in v3 (2026-11-18)
Based on your AI Studio export ajn-precision-engineering.zip (src dated 2026-11-18 23:12).
Files (replace/add at these paths):
  src/components/PlayerWidget.tsx  (NEW) shared collapsible widgets, per-breakpoint memory, accordion under 1024
  src/components/PlayerView.tsx    video Full player = stage + transport + widgets (Now playing, Up Next/On Now, Headlines & captions, Episode note)
  src/components/MiniPlayerDock.tsx  visible "Full player" label (Radio keeps Expand Deck + new Full player button)
  src/index.css                    one-screen player layout: >=1024 two columns, <1024 stage + scrolling widgets
Not changed: BrowsePanel.tsx, MinimalPlayer.tsx (not needed). Audio/Radio page is stage 2.
Test: open a video in Full player at 1366x768 and at phone width; no page scroll, widget headers toggle.
